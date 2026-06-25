import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { updateMaintenancePlan, deleteMaintenancePlan } from '@/modules/equipment';
import { withMutation } from '@/core/api-wrapper';
import { ServiceError } from '@/services/service-error';

export const runtime = 'nodejs';

const emptyToUndef = (v: unknown) => (v === '' || v === null ? undefined : v);

const updateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  type: z.enum(['EO', 'TO1', 'TO2', 'TO3', 'SEASONAL']).optional(),
  triggerType: z.enum(['HOURS', 'CALENDAR']).optional(),
  intervalHours: z.preprocess(emptyToUndef, z.coerce.number().int().positive()).optional().nullable(),
  intervalDays: z.preprocess(emptyToUndef, z.coerce.number().int().positive()).optional().nullable(),
  leadTimeDays: z.preprocess(emptyToUndef, z.coerce.number().int().min(0)).optional().nullable(),
  lastDoneHours: z.preprocess(emptyToUndef, z.coerce.number().int().min(0)).optional().nullable(),
  lastDoneAt: z.preprocess(emptyToUndef, z.coerce.date()).optional().nullable(),
  isActive: z.boolean().optional(),
});

export const PATCH = withMutation(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'maintenance.manage');

    const { id } = await params;
    const body = await request.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.issues.map((e) => ({ field: e.path.join('.'), message: e.message })) },
        { status: 400 }
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID;
    if (!tenantId) return NextResponse.json({ error: 'Tenant context missing' }, { status: 400 });

    try {
      const plan = await updateMaintenancePlan(id, parsed.data, { tenantId });
      return NextResponse.json({ plan });
    } catch (err) {
      if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
  },
  { domain: 'equipment.maintenance' }
);

export const DELETE = withMutation(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'maintenance.manage');

    const { id } = await params;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID;
    if (!tenantId) return NextResponse.json({ error: 'Tenant context missing' }, { status: 400 });

    try {
      await deleteMaintenancePlan(id, { tenantId });
      return NextResponse.json({ success: true });
    } catch (err) {
      if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
  },
  { domain: 'equipment.maintenance' }
);
