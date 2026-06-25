import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { createMaintenancePlan, listMaintenancePlans } from '@/modules/equipment';
import { evaluatePlanDue } from '@/lib/pm-due';
import { withApi, withMutation } from '@/core/api-wrapper';
import { ServiceError } from '@/services/service-error';

export const runtime = 'nodejs';

const emptyToUndef = (v: unknown) => (v === '' || v === null ? undefined : v);

const createSchema = z.object({
  equipmentId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  type: z.enum(['EO', 'TO1', 'TO2', 'TO3', 'SEASONAL']).optional(),
  triggerType: z.enum(['HOURS', 'CALENDAR']),
  intervalHours: z.preprocess(emptyToUndef, z.coerce.number().int().positive()).optional().nullable(),
  intervalDays: z.preprocess(emptyToUndef, z.coerce.number().int().positive()).optional().nullable(),
  leadTimeDays: z.preprocess(emptyToUndef, z.coerce.number().int().min(0)).optional().nullable(),
  lastDoneHours: z.preprocess(emptyToUndef, z.coerce.number().int().min(0)).optional().nullable(),
  lastDoneAt: z.preprocess(emptyToUndef, z.coerce.date()).optional().nullable(),
});

export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'maintenance.manage');

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID ?? '';
    const equipmentId = request.nextUrl.searchParams.get('equipmentId') ?? undefined;
    const plans = await listMaintenancePlans(tenantId, equipmentId);

    // Attach computed due status (pure) so the UI doesn't re-derive it.
    // Current hours = latest meter reading, falling back to the engineHoursTotal
    // cache (P2 keeps it = latest reading; also covers rigs with no journal yet).
    const withDue = plans.map((p) => ({
      ...p,
      due: evaluatePlanDue(p, p.equipment.meterReadings[0]?.engineHours ?? p.equipment.engineHoursTotal ?? null),
    }));
    return NextResponse.json({ plans: withDue });
  },
  { domain: 'equipment.maintenance' }
);

export const POST = withMutation(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'maintenance.manage');

    const body = await request.json();
    const parsed = createSchema.safeParse(body);
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
      const plan = await createMaintenancePlan(parsed.data, { tenantId });
      return NextResponse.json({ plan }, { status: 201 });
    } catch (err) {
      if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
  },
  { domain: 'equipment.maintenance' }
);
