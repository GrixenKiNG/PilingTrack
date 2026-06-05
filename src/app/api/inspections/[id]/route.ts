import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { getInspection, saveAnswers } from '@/modules/inspections';
import { withApi, withMutation } from '@/core/api-wrapper';
import { ServiceError } from '@/services/service-error';

export const runtime = 'nodejs';

const answersSchema = z.object({
  answers: z.array(
    z.object({
      itemId: z.string().min(1),
      result: z.string().max(40),
      value: z.string().max(200).optional().nullable(),
      note: z.string().max(2000).optional().nullable(),
      photoCount: z.number().int().min(0).optional(),
    })
  ),
});

export const GET = withApi(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    assertCan(user!, 'maintenance.manage');
    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID ?? '';
    const { id } = await params;
    try {
      const inspection = await getInspection(id, tenantId);
      return NextResponse.json({ inspection });
    } catch (err) {
      if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
  },
  { domain: 'inspections' }
);

export const PUT = withMutation(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    assertCan(user!, 'maintenance.manage');
    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID ?? '';
    const { id } = await params;
    const parsed = answersSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.issues.map((e) => ({ field: e.path.join('.'), message: e.message })) },
        { status: 400 }
      );
    }
    try {
      const inspection = await saveAnswers(id, parsed.data.answers, { tenantId });
      return NextResponse.json({ inspection });
    } catch (err) {
      if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
  },
  { domain: 'inspections' }
);
