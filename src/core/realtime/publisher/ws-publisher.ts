/**
 * WS Publisher — Bridge from Outbox/EventBus to WebSocket
 *
 * Reads pending events from outbox and publishes them to Redis Pub/Sub.
 * WS server subscribes to Redis and delivers to connected clients.
 *
 * This worker runs alongside the existing outbox-worker.
 * It ensures real-time delivery while maintaining outbox reliability.
 *
 * Flow:
 *   Outbox (pending) → Redis Pub/Sub → WS Server → Clients
 */

import { db } from '@/lib/db';
import { publishToRedis, CHANNEL_EVENTS } from '../redis/pubsub';
import { evaluateAlert } from '../alerts/engine';
import { logger } from '@/lib/logger';

// ============================================================
// Configuration
// ============================================================

const POLL_INTERVAL_MS = 2000; // Check every 2s (faster than regular outbox worker)
const BATCH_SIZE = 50;

// ============================================================
// Publisher Worker
// ============================================================

export async function publishPendingEvents(): Promise<number> {
  // Fetch unpublished events
  const events = await db.outboxEvent.findMany({
    where: { published: false },
    orderBy: { createdAt: 'asc' },
    take: BATCH_SIZE,
  });

  if (events.length === 0) return 0;

  let published = 0;

  for (const outboxEvent of events) {
    try {
      const eventPayload = outboxEvent.payload as Record<string, unknown>;

      // Normalize event for realtime
      const realtimeEvent = normalizeEvent(outboxEvent.type, outboxEvent.aggregateId, eventPayload);

      if (realtimeEvent) {
        await publishToRedis(CHANNEL_EVENTS, realtimeEvent);

        // Evaluate alert rules
        await evaluateAlert(realtimeEvent as any);

        // Mark as published (for WS delivery)
        await db.outboxEvent.update({
          where: { id: outboxEvent.id },
          data: {
            published: true,
            publishedAt: new Date(),
          },
        });

        published++;
      }
    } catch (error) {
      logger.error('Failed to publish event to Redis', error, {
        outboxId: outboxEvent.id,
        type: outboxEvent.type,
      });
    }
  }

  if (published > 0) {
    logger.debug('Published events to Redis', { count: published });
  }

  return published;
}

/**
 * Normalize outbox event into realtime event format.
 */
function normalizeEvent(
  type: string,
  aggregateId: string,
  payload: Record<string, unknown>
): Record<string, unknown> | null {
  // Map domain event types to realtime event types
  const typeMap: Record<string, string> = {
    ReportCreated: 'report.created',
    ReportUpdated: 'report.updated',
    ReportSubmitted: 'report.submitted',
    PileWorkAdded: 'report.updated',
    DrillingAdded: 'report.updated',
    DowntimeAdded: 'downtime.added',
  };

  const realtimeType = typeMap[type];
  if (!realtimeType) {
    // Unknown event type — skip WS delivery but don't fail
    return null;
  }

  // Extract entity and metadata
  const entity = type.startsWith('Report') || type.startsWith('Pile') || type.startsWith('Drilling')
    ? 'report'
    : type.startsWith('Downtime')
      ? 'report'
      : 'system';

  return {
    id: crypto.randomUUID(),
    type: realtimeType,
    entity,
    entityId: aggregateId,
    payload: extractPayload(type, payload),
    tenantId: (payload.tenantId as string) || null,
    siteId: (payload.siteId as string) || null,
    userId: (payload.userId as string) || null,
    ts: Date.now(),
  };
}

/**
 * Extract meaningful payload for the realtime event.
 */
function extractPayload(
  type: string,
  payload: Record<string, unknown>
): Record<string, unknown> {
  switch (type) {
    case 'ReportCreated':
    case 'ReportUpdated':
      return {
        reportId: payload.reportId || payload.aggregateId,
        totalPiles: payload.totalPiles || 0,
        totalDrilling: payload.totalDrilling || 0,
        totalDowntime: payload.totalDowntime || 0,
        status: payload.status || 'draft',
        updatedAt: payload.updatedAt || new Date().toISOString(),
      };

    case 'ReportSubmitted':
      return {
        reportId: payload.reportId,
        siteId: payload.siteId,
        totalPiles: payload.totalPiles || 0,
        totalDrilling: payload.totalDrilling || 0,
        totalDowntime: payload.totalDowntime || 0,
      };

    case 'DowntimeAdded':
      return {
        reasonId: payload.reasonId,
        duration: payload.duration,
        reportId: payload.reportId,
      };

    default:
      return payload;
  }
}

// ============================================================
// Worker Loop
// ============================================================

let isRunning = false;

export function startRealtimePublisher(intervalMs = POLL_INTERVAL_MS) {
  logger.info('Realtime publisher starting', { intervalMs });

  const timer = setInterval(async () => {
    if (isRunning) return; // Prevent overlapping runs
    isRunning = true;

    try {
      const count = await publishPendingEvents();
      if (count > 0) {
        logger.info('Realtime publisher processed events', { count });
      }
    } catch (error) {
      logger.error('Realtime publisher error', error);
    } finally {
      isRunning = false;
    }
  }, intervalMs);

  // Graceful shutdown
  process.on('SIGTERM', () => {
    logger.info('Realtime publisher shutting down');
    clearInterval(timer);
  });

  process.on('SIGINT', () => {
    clearInterval(timer);
  });

  return {
    stop: () => clearInterval(timer),
  };
}
