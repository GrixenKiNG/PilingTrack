import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { listInspections, startInspection } from '@/modules/inspections';
import { withApi, withMutation } from '@/core/api-wrapper';
import { ServiceError } from '@/services/service-error';

export const runtime = 'nodejs';

const startSchema = z.object({
  equipmentId: z.string().min(1),
  templateId: z.string().min(1),
  inspectionDate: z.coerce.date(),
  shift: z.string().max(20).optional().nullable(),
  engineHours: z.coerce.number().int().min(0).optional().nullable(),
});

export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    assertCan(user!, 'maintenance.manage');
    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID ?? '';
    const operatorUserId = user!.role === 'OPERATOR' ? user!.id : null;
    const equipmentId = request.nextUrl.searchParams.get('equipmentId') ?? undefined;
    const level = request.nextUrl.searchParams.get('level') ?? undefined;
    const inspections = await listInspections(tenantId, { equipmentId, level }, operatorUserId);
    return NextResponse.json({ inspections });
  },
  { domain: 'inspections' }
);

export const POST = withMutation(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    assertCan(user!, 'maintenance.manage');
    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID;
    if (!tenantId) return NextResponse.json({ error: 'Tenant context missing' }, { status: 400 });
    const parsed = startSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.issues.map((e) => ({ field: e.path.join('.'), message: e.message })) },
        { status: 400 }
      );
    }
    try {
      const inspection = await startInspection(parsed.data, { tenantId, userId: user!.id });
      return NextResponse.json({ inspection }, { status: 201 });
    } catch (err) {
      if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
  },
  { domain: 'inspections' }
);
