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
    } as any,
    orderBy: { createdAt: 'asc' },
    take: BATCH_SIZE,
  });

  if (events.length === 0) return 0;

  let processedCount = 0;

  for (const outboxEvent of events) {
    // Idempotency check: skip if another replica of this consumer already
    // processed the row.
    const current = await db.outboxEvent.findUnique({
      where: { id: outboxEvent.id },
      select: { [consumerColumn]: true } as any,
    }) as Record<string, boolean> | null;

    if (current?.[consumerColumn]) continue;

    try {
      const event = outboxEvent.payload as unknown as ReportDomainEvent;

      await handler(event);

      // Mark this consumer as done. Only this consumer's column is touched
      // — the other consumer still sees the row as unconsumed.
      await db.outboxEvent.update({
        where: { id: outboxEvent.id, [consumerColumn]: false } as any,
        data: {
          [consumerColumn]: true,
          ...(consumerColumn === 'published' ? { publishedAt: new Date() } : {}),
        } as any,
      });

      processedCount++;
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
  const interval = setInterval(async () => {
    try {
      const count = await publishOutboxEvents(handler);
      if (count > 0) {
        logger.info('Outbox worker processed events', { count });
      }
    } catch (error) {
      logger.error('Outbox worker error', error);
    }
  }, intervalMs);

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
