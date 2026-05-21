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
  createdAt: Date;
  status: 'pending' | 'resolved' | 'discarded';
}

export async function moveToDlq(
  outboxId: string,
  eventType: string,
  aggregateId: string | null,
  payload: unknown,
  error: unknown,
  attempts: number
): Promise<void> {
  const errorMessage = error instanceof Error ? error.message : String(error);

  try {
    await db.deadLetterQueue.create({
      data: {
        eventType,
        aggregateId,
        payload: payload as any,
        errorMessage: errorMessage.substring(0, 2000),
        attempts,
        sourceOutboxId: outboxId,
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
  } catch (dlqError) {
    // Last resort — log to console
    logger.error('DLQ: failed to move event to DLQ', dlqError);
  }
}

export async function retryDlqEntry(id: string): Promise<boolean> {
  const entry = await db.deadLetterQueue.findUnique({ where: { id } });
  if (!entry) return false;

  try {
    // Re-insert into outbox for retry
    await db.outboxEvent.create({
      data: {
        id: entry.id, // Reuse same ID
        type: entry.eventType,
        aggregateId: entry.aggregateId ?? 'unknown',
        aggregateType: 'Report',
        payload: entry.payload as any,
        attempts: 0,
        published: false,
      },
    });

    await db.deadLetterQueue.update({
      where: { id },
      data: { status: 'resolved' },
    });

    return true;
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
    createdAt: row.createdAt,
    status: row.status as DlqEntry['status'],
  }));
}
