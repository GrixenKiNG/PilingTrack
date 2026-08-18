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
import { projectWeeklyTrend } from './projection-handlers';
import {consumeReadinessProjectionEvent} from '@/modules/readiness/application/projection/consumer';
import { forEachTenant } from '@/lib/tenant-iteration';

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

/**
 * Достроить конверт события маршрутными полями из самой записи отчёта.
 *
 * Транзакционный outbox кладёт в payload только `event.data`, а siteId/userId/
 * tenantId живут в колонках и при восстановлении события теряются. Все
 * проекции ниже начинаются с `if (!siteId || !userId) return`, поэтому молча
 * не писали ничего — а событие всё равно помечалось projected=true, так что и
 * ретрая не было: ReportStats, OperatorPerformance, DowntimeSummary и
 * SiteWeeklyTrend наполнялись только ручным rebuild'ом. Тот же дефект уже
 * чинили в handleReportForDailySummary (services/reports/event-handlers.ts) —
 * здесь его пропустили.
 *
 * `aggregateId` — это Report.reportId (бизнес-ключ), а не первичный `id`.
 * Для REPORT_DELETED строки уже нет: возвращаем событие как есть, и проекции
 * отрабатывают прежний ранний выход.
 */
async function enrichReportEvent(
  event: ReportDomainEvent
): Promise<{ event: ReportDomainEvent; reportDate: string | null }> {
  const eventDate = typeof event.data?.date === 'string' ? event.data.date : null;
  if (event.siteId && event.userId && eventDate) {
    return { event, reportDate: eventDate };
  }

  const report = await db.report.findUnique({
    where: { reportId: event.aggregateId },
    select: { siteId: true, userId: true, tenantId: true, date: true },
  });
  if (!report) return { event, reportDate: eventDate };

  return {
    event: {
      ...event,
      siteId: event.siteId ?? report.siteId,
      userId: event.userId ?? report.userId,
      tenantId: event.tenantId ?? report.tenantId ?? undefined,
      // Дата смены докладывается в data, если её там не было: обработчики
      // обязаны считать по рабочей дате отчёта, а не по дню отправки события.
      data: eventDate ? event.data : { ...event.data, date: report.date },
    },
    reportDate: eventDate ?? report.date,
  };
}

async function projectEvent(event: ReportDomainEvent) {
  if (await consumeReadinessProjectionEvent(event)) return;
  const normalizedEvent = normalizeProjectionEvent(event);
  if (!normalizedEvent) {
    if (process.env.LOG_PROJECTION_SKIPS === 'true') {
      logger.debug('Projection skipped non-report event', {
        eventType: (event as { type?: string })?.type,
      });
    }
    return;
  }

  const { event: enrichedEvent, reportDate } = await enrichReportEvent(normalizedEvent);

  try {
    // Раньше здесь тремя параллельными upsert-ами обновлялись ReportStats,
    // OperatorPerformance и DowntimeSummary — каждый со своим запросом отчёта
    // со всеми дочерними строками. Ни одну из трёх проекций не читала ни одна
    // витрина, так что работа на каждом событии делалась впустую. Удалено
    // 17.08.2026 вместе с обработчиками.
    if (
      enrichedEvent.type.startsWith('Report') ||
      enrichedEvent.type.startsWith('Pile') ||
      enrichedEvent.type.startsWith('Drilling')
    ) {
      if (enrichedEvent.siteId) {
        await projectWeeklyTrend(enrichedEvent.siteId, reportDate);
      }
    }
  } catch (error) {
    // Re-throw so consumeOutboxEvents can drive retry / DLQ. Swallowing
    // here used to mark every event as `projected=true` even when the
    // upsert failed, hiding silent data loss in SiteWeeklyTrend the same
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

  // Ежечасный пересчёт недельного тренда идёт по организациям, а не по всем
  // объектам разом: у фоновой задачи нет запроса, значит нет и контекста,
  // который заводит обёртка маршрута. Без него после перевода политик RLS в
  // fail-closed выборка объектов вернулась бы пустой, и тренд молча перестал
  // бы обновляться.
  const weeklyInterval = setInterval(async () => {
    try {
      await forEachTenant(async (tenantId) => {
        const sites = await db.site.findMany({ where: { tenantId }, select: { id: true } });
        for (const site of sites) {
          await projectWeeklyTrend(site.id);
        }
      });
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
