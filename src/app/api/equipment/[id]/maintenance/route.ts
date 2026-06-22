import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { createMaintenance, listMaintenance } from '@/modules/equipment';
import { withApi, withMutation } from '@/core/api-wrapper';
import { ServiceError } from '@/services/service-error';

export const runtime = 'nodejs';

const typeEnum = z.enum(['EO', 'TO1', 'TO2', 'TO3', 'SEASONAL', 'REPAIR', 'FAULT', 'SCHEDULED', 'INSPECTION']);
const statusEnum = z.enum(['PLANNED', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'DONE', 'CANCELLED']);
const priorityEnum = z.enum(['LOW', 'NORMAL', 'HIGH', 'CRITICAL']);

const emptyToUndef = (v: unknown) => (v === '' || v === null ? undefined : v);

const createSchema = z.object({
  type: typeEnum,
  status: statusEnum.optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional(),
  scheduledAt: z.preprocess(emptyToUndef, z.coerce.date()).optional().nullable(),
  completedAt: z.preprocess(emptyToUndef, z.coerce.date()).optional().nullable(),
  engineHoursAtService: z.preprocess(emptyToUndef, z.coerce.number().int().min(0)).optional().nullable(),
  cost: z.preprocess(emptyToUndef, z.coerce.number().min(0)).optional().nullable(),
  performedBy: z.string().max(200).optional().nullable(),
  priority: priorityEnum.optional(),
  startedAt: z.preprocess(emptyToUndef, z.coerce.date()).optional().nullable(),
  laborHours: z.preprocess(emptyToUndef, z.coerce.number().min(0)).optional().nullable(),
  assigneeId: z.string().optional().nullable(),
  faultCause: z.string().max(2000).optional().nullable(),
  workDone: z.string().max(4000).optional().nullable(),
  partsUsedText: z.string().max(2000).optional().nullable(),
});

export const GET = withApi(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'maintenance.manage');

    const { id } = await params;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID ?? '';
    const records = await listMaintenance(id, tenantId);
    return NextResponse.json({ records });
  },
  { domain: 'equipment.maintenance' }
);

export const POST = withMutation(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'maintenance.manage');

    const { id } = await params;
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
    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant context missing' }, { status: 400 });
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
      const record = await createMaintenance(id, parsed.data, { tenantId, createdById: user!.id });
      return NextResponse.json({ record }, { status: 201 });
    } catch (err) {
      if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
  },
  { domain: 'equipment.maintenance' }
);
