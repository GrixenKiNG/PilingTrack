/**
 * Outbox Publisher — Transactional Outbox Pattern
 *
 * Гарантирует, что события будут опубликованы даже если:
 * - основной transaction succeeded, но event bus упал
 * - процесс умер между записью в БД и публикацией
 * - network glitch при отправке
 *
 * Pattern:
 * 1. В той же транзакции что и бизнес-данные → пишем OutboxEvent
 * 2. Фоновый polling → читаем unpublished events
 * 3. Публикуем → marking as published
 * 4. Retry с exponential backoff для failed events
 */

import { db } from '@/lib/db';
// eslint-disable-next-line no-restricted-imports -- legacy cross-layer import pending the parked services<->modules migration (CLAUDE.md); behavior-neutral
import { ReportDomainEvent } from '@/modules/reports/domain';
import { logger } from '@/lib/logger';
import { moveToDlq } from '@/core/outbox/dead-letter-queue';

const MAX_RETRIES = 5;
const RETRY_BASE_DELAY_MS = 1000; // 1s base
const RETRY_MAX_DELAY_MS = 60000; // 60s cap
const BATCH_SIZE = 100;

/**
 * Calculate exponential backoff delay with jitter.
 * Formula: min(base * 2^attempts, max) * (1 + random * 0.3)
 */
function getBackoffDelay(attempts: number): number {
  const base = RETRY_BASE_DELAY_MS;
  const max = RETRY_MAX_DELAY_MS;
  const exponential = Math.min(base * Math.pow(2, attempts), max);
  const jitter = exponential * 0.3 * Math.random(); // 30% jitter
  return Math.round(exponential + jitter);
}

/**
 * Save events to outbox WITHIN the same transaction as business data.
 * Call this inside db.$transaction().
 */
export async function saveToOutbox(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma interactive-transaction callback client type isn't cleanly exported
  tx: any,
  events: ReportDomainEvent[]
): Promise<void> {
  if (events.length === 0) return;

  await Promise.all(
    events.map((event) =>
      tx.outboxEvent.create({
        data: {
          type: event.type,
          aggregateId: event.aggregateId,
          aggregateType: event.aggregateType,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma JSON column / event payload is an arbitrary serializable shape
          payload: event as any, // JSON
        },
      })
    )
  );
}

/**
 * Generic outbox consumer loop.
 *
 * The outbox table has TWO independent consumers:
 *   - `published` — used by the external event bus publisher
 *   - `projected` — used by the CQRS projection worker
 *
 * Each consumer has its own boolean flag, so they advance independently
 * and do not race to mark the same row consumed (which previously caused
 * projections to silently skip events whenever the publisher got there
 * first). Retry/backoff state (attempts, nextRetryAt, lastError) is shared.
 */
async function consumeOutboxEvents(
  consumerColumn: 'published' | 'projected',
  handler: (event: ReportDomainEvent) => Promise<void>,
): Promise<number> {
  const now = new Date();

  // Fetch events not yet consumed by THIS consumer, whose backoff has expired.
  const events = await db.outboxEvent.findMany({
    where: {
      [consumerColumn]: false,
      OR: [
        { nextRetryAt: null },
        { nextRetryAt: { lte: now } },
      ],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped external/library boundary
    } as any,
    orderBy: { createdAt: 'asc' },
    take: BATCH_SIZE,
  });

  if (events.length === 0) return 0;

  let processedCount = 0;

  for (const outboxEvent of events) {
    // NOTE: handlers MUST be idempotent. Two replicas of this consumer can
    // race, both pass the findMany window, both run the handler, only one
    // wins the atomic updateMany below. Duplicate side effects are not
    // prevented here — they're absorbed by handler idempotency.
    try {
      // Reconstruct the domain event from outbox columns. Some writers store
      // the full event in `payload`, others store only `event.data`. We treat
      // `payload` as a partial source and override the routing fields with
      // the canonical column values so dispatch by `type` always works.
      const payloadObj = (outboxEvent.payload && typeof outboxEvent.payload === 'object'
        ? (outboxEvent.payload as Record<string, unknown>)
        : {}) as Record<string, unknown>;
      const looksLikeFullEvent = typeof payloadObj.type === 'string' && 'data' in payloadObj;
      const event = {
        ...(looksLikeFullEvent ? payloadObj : {}),
        id: outboxEvent.id,
        type: outboxEvent.type,
        aggregateId: outboxEvent.aggregateId,
        aggregateType: outboxEvent.aggregateType,
        occurredAt: outboxEvent.occurredAt.toISOString(),
        data: looksLikeFullEvent ? (payloadObj.data ?? {}) : payloadObj,
      } as unknown as ReportDomainEvent;

      await handler(event);

      // Atomic claim: only this consumer's column is touched. updateMany
      // (not update) so a losing race returns {count:0} instead of
      // throwing P2025, which would otherwise land in the catch below and
      // re-schedule retry for an event that's already been processed.
      const claim = await db.outboxEvent.updateMany({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped external/library boundary
        where: { id: outboxEvent.id, [consumerColumn]: false } as any,
        data: {
          [consumerColumn]: true,
          ...(consumerColumn === 'published' ? { publishedAt: new Date() } : {}),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped external/library boundary
        } as any,
      });

      if (claim.count > 0) {
        processedCount++;
      }
    } catch (error) {
      const attempts = outboxEvent.attempts + 1;
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (attempts >= MAX_RETRIES) {
        // Max retries exceeded — move to DLQ for manual inspection
        await moveToDlq(
          outboxEvent.id,
          outboxEvent.type,
          outboxEvent.aggregateId,
          outboxEvent.payload,
          error,
          attempts,
        );
        // Claim this consumer's column so the row is not re-fetched on the
        // next tick. moveToDlq only writes to DeadLetterQueue; without this
        // claim, the polling loop re-picks the row, the handler fails again,
        // attempts ticks past MAX_RETRIES again, and a duplicate lands in
        // DLQ every interval. The two consumers ('published' / 'projected')
        // are independent — only the one that hit max retries is advanced.
        await db.outboxEvent.update({
          where: { id: outboxEvent.id },
          data: {
            attempts,
            lastError: `Moved to DLQ: ${errorMessage.substring(0, 500)}`,
            [consumerColumn]: true,
            ...(consumerColumn === 'published' ? { publishedAt: new Date() } : {}),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped external/library boundary
          } as any,
        });
      } else {
        // Schedule next retry with exponential backoff
        const backoffMs = getBackoffDelay(attempts);
        const nextRetryAt = new Date(Date.now() + backoffMs);

        await db.outboxEvent.update({
          where: { id: outboxEvent.id },
          data: {
            attempts,
            lastError: errorMessage.substring(0, 500),
            nextRetryAt,
          },
        });

        logger.debug('Outbox event scheduled for retry', {
          consumer: consumerColumn,
          eventId: outboxEvent.id,
          type: outboxEvent.type,
          attempts,
          nextRetryAt,
          backoffMs,
        });
      }
    }
  }

  return processedCount;
}

/**
 * Publish unpublished events to the external event bus.
 * Marks rows as `published=true` — does NOT advance the projection consumer.
 */
export async function publishOutboxEvents(
  handler: (event: ReportDomainEvent) => Promise<void>,
): Promise<number> {
  return consumeOutboxEvents('published', handler);
}

/**
 * Feed events to the CQRS projection worker.
 * Marks rows as `projected=true` — independent from the publish consumer, so
 * both workers see every event exactly once (per consumer).
 */
export async function projectOutboxEvents(
  handler: (event: ReportDomainEvent) => Promise<void>,
): Promise<number> {
  return consumeOutboxEvents('projected', handler);
}

/**
 * Polling worker — runs continuously to process outbox events.
 * Can be run as a background process or serverless cron.
 */
export function startOutboxWorker(
  handler: (event: ReportDomainEvent) => Promise<void>,
  intervalMs: number = 10000 // 10 seconds
) {
  // Re-entrancy guard. consumeOutboxEvents dispatches the handler BEFORE it
  // atomically claims the row (dispatch-then-mark, so a failed handler retries).
  // The handlers include a NON-idempotent Telegram send (report PDF). With a
  // naive setInterval, a slow pass (PDF render + Telegram upload can take longer
  // than intervalMs — the embedded worker polls every 2s) lets the next tick
  // start while the previous is mid-send: both findMany the same not-yet-claimed
  // row and both send the PDF → duplicate Telegram reports. Skipping a tick
  // while a pass is still running makes dispatch effectively single-flight.
  let running = false;
  const processOnce = async () => {
    if (running) return;
    running = true;
    try {
      const count = await publishOutboxEvents(handler);
      if (count > 0) {
        logger.info('Outbox worker processed events', { count });
      }
    } catch (error) {
      logger.error('Outbox worker error', error);
    } finally {
      running = false;
    }
  };

  void processOnce();
  const interval = setInterval(processOnce, intervalMs);

  // Cleanup on process exit
  if (typeof process !== 'undefined') {
    process.on('SIGTERM', () => clearInterval(interval));
    process.on('SIGINT', () => clearInterval(interval));
  }

  return {
    stop: () => clearInterval(interval),
  };
}

/**
 * Get outbox stats (for diagnostics).
 */
export async function getOutboxStats(): Promise<{
  unpublished: number;
  failed: number;
  total: number;
}> {
  const [unpublished, failed, total] = await Promise.all([
    db.outboxEvent.count({ where: { published: false } }),
    db.outboxEvent.count({
      where: {
        published: false,
        attempts: { gte: MAX_RETRIES },
      },
    }),
    db.outboxEvent.count(),
  ]);

  return { unpublished, failed, total };
}
