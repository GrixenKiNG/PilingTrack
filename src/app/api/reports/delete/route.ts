import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { withMutation } from '@/core/api-wrapper';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

const schema = z.object({ reportId: z.string().min(1) });

export const DELETE = withMutation(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    assertCan(user!, 'reports.manage_all');

    const body = await request.json().catch(() => ({}));
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation error', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    try {
      await db.report.delete({ where: { reportId: parsed.data.reportId } });
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      if (message.includes('Record to delete') || message.includes('not found')) {
        return NextResponse.json({ error: 'Report not found' }, { status: 404 });
      }
      throw err;
    }

    return NextResponse.json({ ok: true });
  },
  { domain: 'reports' }
);
