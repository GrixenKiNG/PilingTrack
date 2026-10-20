import { db } from '@/lib/db';

/** Число попыток доставки, после которого событие outbox считается «упавшим». */
export const MAX_OUTBOX_RETRIES = 5;

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
        attempts: { gte: MAX_OUTBOX_RETRIES },
      },
    }),
    db.outboxEvent.count(),
  ]);

  return { unpublished, failed, total };
}
