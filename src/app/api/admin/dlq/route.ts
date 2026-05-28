import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { withApi, withMutation } from '@/core/api-wrapper';
import {
  getPendingDlqEntries,
  getDlqStats,
  retryDlqEntry,
  discardDlqEntry,
} from '@/core/outbox/dead-letter-queue';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    assertCan(user!, 'dlq.manage');

    const status = request.nextUrl.searchParams.get('status') ?? 'pending';
    const limit = Math.min(Number(request.nextUrl.searchParams.get('limit') ?? '100'), 500);

    const stats = await getDlqStats();

    if (status === 'pending') {
      const entries = await getPendingDlqEntries(limit);
      return NextResponse.json({ entries, stats });
    }

    // For resolved/discarded/all statuses, use raw query
    const where = status === 'all' ? {} : { status };
    const rows = await db.deadLetterQueue.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return NextResponse.json({
      entries: rows.map((r) => ({
        id: r.id,
        eventType: r.eventType,
        aggregateId: r.aggregateId,
        payload: r.payload,
        errorMessage: r.errorMessage,
        attempts: r.attempts,
        sourceOutboxId: r.sourceOutboxId,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        status: r.status,
      })),
      stats,
    });
  },
  { domain: 'admin-dlq' }
);

const actionSchema = z.object({
  id: z.string().min(1),
  action: z.enum(['retry', 'discard']),
});

export const POST = withMutation(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    assertCan(user!, 'dlq.manage');

    const body = await request.json();
    const validation = actionSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.flatten() },
        { status: 400 }
      );
    }

    const { id, action } = validation.data;

    if (action === 'retry') {
      const ok = await retryDlqEntry(id);
      if (!ok) {
        return NextResponse.json({ error: 'Не удалось переотправить' }, { status: 400 });
      }
      return NextResponse.json({ ok: true, action });
    }

    await discardDlqEntry(id);
    return NextResponse.json({ ok: true, action });
  },
  { domain: 'admin-dlq' }
);
