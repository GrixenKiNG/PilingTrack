import { db } from '@/lib/db';

export async function isIdempotent(opId: string): Promise<boolean> {
  const existing = await db.idempotencyKey.findUnique({
    where: { id: opId },
    select: { id: true },
  });
  return existing !== null;
}

export async function recordIdempotency(opId: string, scope: string): Promise<void> {
  try {
    await db.idempotencyKey.create({
      data: {
        id: opId,
        key: opId,
        scope,
        status: 'completed',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });
  } catch {
    // Unique constraint violation — already recorded (fine)
  }
}
