/**
 * Projection Worker - CQRS Read Model Updater
 *
 * Listens to report-domain events and updates denormalized read models.
 * The canonical event model is PascalCase (`ReportCreated`, `DowntimeAdded`),
 * while dotted aliases are normalized at the boundaries for compatibility.
 */

import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import {
  ReportDomainEvent,
  REPORT_DOMAIN_EVENT_TYPES,
  normalizeReportDomainEventType,
} from '@/modules/reports/domain';
// eslint-disable-next-line no-restricted-imports -- legacy cross-layer import pending the parked services<->modules migration (CLAUDE.md); behavior-neutral
import { projectOutboxEvents } from '@/services/reports/outbox-publisher';
import {
  projectDowntimeSummary,
  projectOperatorPerformance,
  projectReportStats,
  projectWeeklyTrend,
} from './projection-handlers';

// Re-export: callers (rebuild.ts, reports/delete route) import it from here.
export { projectOperatorPerformanceFull } from './projection-handlers';

function shouldLogProjectionLifecycle(): boolean {
  return process.env.LOG_WORKER_LIFECYCLE === 'true';
}

const PROJECTABLE_EVENT_TYPES = new Set<string>([
  REPORT_DOMAIN_EVENT_TYPES.REPORT_CREATED,
  REPORT_DOMAIN_EVENT_TYPES.REPORT_UPDATED,
  REPORT_DOMAIN_EVENT_TYPES.REPORT_SUBMITTED,
  REPORT_DOMAIN_EVENT_TYPES.REPORT_DELETED,
  REPORT_DOMAIN_EVENT_TYPES.REPORT_VERSION_CREATED,
  REPORT_DOMAIN_EVENT_TYPES.PILE_WORK_ADDED,
  REPORT_DOMAIN_EVENT_TYPES.PILE_WORK_REMOVED,
  REPORT_DOMAIN_EVENT_TYPES.DRILLING_ADDED,
  REPORT_DOMAIN_EVENT_TYPES.DRILLING_REMOVED,
  REPORT_DOMAIN_EVENT_TYPES.DOWNTIME_ADDED,
  REPORT_DOMAIN_EVENT_TYPES.DOWNTIME_REMOVED,
]);

function normalizeProjectionEvent(event: unknown): ReportDomainEvent | null {
  if (!event || typeof event !== 'object') {
    return null;
  }

  const maybeEvent = event as Partial<ReportDomainEvent>;
  const normalizedType = normalizeReportDomainEventType(maybeEvent.type);
  if (!normalizedType || typeof maybeEvent.aggregateId !== 'string') {
    return null;
  }

  if (!PROJECTABLE_EVENT_TYPES.has(normalizedType)) {
    return null;
  }

  return {
    ...(maybeEvent as ReportDomainEvent),
    type: normalizedType,
  };
}

export function getProjectionDate(event: ReportDomainEvent, fallbackDate?: string | null): string | null {
  if (event.occurredAt) {
    const occurredAt = new Date(event.occurredAt);
    if (!Number.isNaN(occurredAt.getTime())) {
      return occurredAt.toISOString().split('T')[0];
    }
  }

  const eventDate = typeof event.data?.date === 'string' ? event.data.date : null;
  if (eventDate && /^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
    return eventDate;
  }

  return fallbackDate || null;
}

async function projectEvent(event: ReportDomainEvent) {
  const normalizedEvent = normalizeProjectionEvent(event);
  if (!normalizedEvent) {
    if (process.env.LOG_PROJECTION_SKIPS === 'true') {
      logger.debug('Projection skipped non-report event', {
        eventType: (event as { type?: string })?.type,
      });
    }
    return;
  }

  try {
    await Promise.all([
      projectReportStats(normalizedEvent),
      projectOperatorPerformance(normalizedEvent),
      projectDowntimeSummary(normalizedEvent),
    ]);

    if (
      normalizedEvent.type.startsWith('Report') ||
      normalizedEvent.type.startsWith('Pile') ||
      normalizedEvent.type.startsWith('Drilling')
    ) {
      if (normalizedEvent.siteId) {
        await projectWeeklyTrend(normalizedEvent.siteId);
      }
    }
  } catch (error) {
    // Re-throw so consumeOutboxEvents can drive retry / DLQ. Swallowing
    // here used to mark every event as `projected=true` even when the
    // upsert failed, hiding silent data loss in ReportStats /
    // OperatorPerformance / DowntimeSummary / SiteWeeklyTrend the same
    // way ReportAnalytics was hidden until the 2026-05-20 incident.
    logger.error('Projection failed', error, {
      eventType: normalizedEvent.type,
      aggregateId: normalizedEvent.aggregateId,
    });
    throw error;
  }
}

export function startProjectionWorker(intervalMs = 5000) {
  if (shouldLogProjectionLifecycle()) {
    logger.info('Projection worker starting', { intervalMs });
  }

  // Re-entrancy guard: don't let a new pass start while the previous is still
  // running (projections are idempotent, but overlapping passes just pile up
  // duplicate DB work). Mirrors the guard in startOutboxWorker.
  let running = false;
  const processOnce = async () => {
    if (running) return;
    running = true;
    try {
      const count = await projectOutboxEvents(projectEvent);
      if (count > 0) {
        logger.info('Projection worker processed events', { count });
      }
    } catch (error) {
      logger.error('Projection worker error', error);
    } finally {
      running = false;
    }
  };

  void processOnce();
  const interval = setInterval(processOnce, intervalMs);

  const weeklyInterval = setInterval(async () => {
    try {
      const sites = await db.site.findMany({ select: { id: true } });
      for (const site of sites) {
        await projectWeeklyTrend(site.id);
      }
    } catch (error) {
      logger.error('Weekly trend recomputation failed', error);
    }
  }, 3600000);

  process.on('SIGTERM', () => {
    if (shouldLogProjectionLifecycle()) {
      logger.info('Projection worker shutting down');
    }
    clearInterval(interval);
    clearInterval(weeklyInterval);
  });

  process.on('SIGINT', () => {
    clearInterval(interval);
    clearInterval(weeklyInterval);
  });

  return {
    stop: () => {
      clearInterval(interval);
      clearInterval(weeklyInterval);
    },
  };
}
