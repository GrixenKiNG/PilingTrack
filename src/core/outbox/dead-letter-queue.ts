/**
 * Dead Letter Queue — Failed outbox events
 *
 * Events that exceed MAX_RETRIES are moved here for:
 * - Manual inspection
 * - Retry with debugging
 * - Alerting on persistent failures
 *
 * Usage:
 *   await deadLetterQueue.moveToDlq(event, error, attempts);
 *   await deadLetterQueue.retry(id);
 *   await deadLetterQueue.discard(id);
 *   const stats = await deadLetterQueue.getStats();
 */

import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

export interface DlqEntry {
  id: string;
  eventType: string;
  aggregateId: string | null;
  payload: unknown;
  errorMessage: string;
  attempts: number;
  sourceOutboxId: string | null;
  createdAt: Date;
  updatedAt: Date;
  status: 'pending' | 'resolved' | 'discarded';
}

/** Откуда пришло событие: этого хватает, чтобы повтор воссоздал его как было. */
export interface DlqOrigin {
  tenantId: string | null;
  aggregateType: string;
  consumer: 'published' | 'projected';
}

export async function moveToDlq(
  outboxId: string,
  eventType: string,
  aggregateId: string | null,
  payload: unknown,
  error: unknown,
  attempts: number,
  origin: DlqOrigin,
): Promise<void> {
  const errorMessage = error instanceof Error ? error.message : String(error);

  try {
    await db.deadLetterQueue.create({
      data: {
        eventType,
        aggregateId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma JSON column / event payload is an arbitrary serializable shape
        payload: payload as any,
        errorMessage: errorMessage.substring(0, 2000),
        attempts,
        sourceOutboxId: outboxId,
        tenantId: origin.tenantId,
        aggregateType: origin.aggregateType,
        consumer: origin.consumer,
      },
    });

    // NOTE: Marking the source OutboxEvent as consumed is the caller's job
    // (consumeOutboxEvents sets its own consumer column atomically). Setting
    // published=false here used to re-queue the row forever — every tick
    // would re-fetch it, the handler would fail again, attempts would tick
    // past MAX_RETRIES, and moveToDlq would be called repeatedly, spamming
    // duplicates into DLQ. Now this function only writes to DLQ; the caller
    // claims the outbox row.

    logger.error('Event moved to Dead Letter Queue', {
      outboxId,
      eventType,
      aggregateId,
      attempts,
      errorMessage,
    });

    // Best-effort Telegram alert — never blocks the DLQ write.
    import('@/core/notifications/telegram').then(({ telegramNotifier }) => {
      void telegramNotifier.sendMessage(
        `⚠️ <b>Dead Letter Queue</b>\n\nСобытие <code>${eventType}</code> исчерпало ${attempts} попыток.\n` +
        (aggregateId ? `aggregateId: <code>${aggregateId}</code>\n` : '') +
        `Ошибка: <code>${errorMessage.substring(0, 200)}</code>`
      ).catch(() => {/* ignore */});
    }).catch(() => {/* ignore */});
  } catch (dlqError) {
    // Last resort — log to console
    logger.error('DLQ: failed to move event to DLQ', dlqError);
  }
}

export async function retryDlqEntry(id: string): Promise<boolean> {
  try {
    return await db.$transaction(async (tx) => {
      // Захват записи и постановка события — одна транзакция. Раньше было две
      // отдельные записи: двойной клик или сбой между ними ставил событие
      // в очередь дважды. Кто не захватил строку (count 0) — ничего не делает.
      const claim = await tx.deadLetterQueue.updateMany({
        where: { id, status: 'pending' },
        data: { status: 'resolved' },
      });
      if (claim.count === 0) return false;

      const entry = await tx.deadLetterQueue.findUnique({ where: { id } });
      if (!entry) return false;

      // Новый id (Prisma сгенерирует): entry.id — это id записи DLQ, а не события.
      // dedupeKey не переносим: исходное событие с ним ещё лежит в outbox.
      await tx.outboxEvent.create({
        data: {
          type: entry.eventType,
          aggregateId: entry.aggregateId ?? 'unknown',
          aggregateType: entry.aggregateType ?? 'Report',
          tenantId: entry.tenantId,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma JSON column / event payload is an arbitrary serializable shape
          payload: entry.payload as any,
          attempts: 0,
          // Второй потребитель это событие уже обработал: повтор будит только
          // того, кто упал. Старые строки (consumer = NULL) — оба, как раньше.
          published: entry.consumer === 'projected',
          projected: entry.consumer === 'published',
        },
      });
      return true;
    });
  } catch (err) {
    logger.error('DLQ retry failed', { id, error: err });
    return false;
  }
}

export async function discardDlqEntry(id: string): Promise<void> {
  await db.deadLetterQueue.update({
    where: { id },
    data: { status: 'discarded' },
  });
}

export async function getDlqStats(): Promise<{
  pending: number;
  resolved: number;
  discarded: number;
  total: number;
}> {
  const [pending, resolved, discarded] = await Promise.all([
    db.deadLetterQueue.count({ where: { status: 'pending' } }),
    db.deadLetterQueue.count({ where: { status: 'resolved' } }),
    db.deadLetterQueue.count({ where: { status: 'discarded' } }),
  ]);

  return { pending, resolved, discarded, total: pending + resolved + discarded };
}

export async function getPendingDlqEntries(limit: number = 100): Promise<DlqEntry[]> {
  const rows = await db.deadLetterQueue.findMany({
    where: { status: 'pending' },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
  return rows.map((row) => ({
    id: row.id,
    eventType: row.eventType,
    aggregateId: row.aggregateId,
    payload: row.payload,
    errorMessage: row.errorMessage,
    attempts: row.attempts,
    sourceOutboxId: row.sourceOutboxId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    status: row.status as DlqEntry['status'],
  }));
}
