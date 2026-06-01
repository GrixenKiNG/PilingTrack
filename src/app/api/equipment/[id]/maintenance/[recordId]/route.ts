import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { updateMaintenance, deleteMaintenance } from '@/modules/equipment';
import { withMutation } from '@/core/api-wrapper';
import { ServiceError } from '@/services/service-error';

export const runtime = 'nodejs';

const typeEnum = z.enum(['SCHEDULED', 'REPAIR', 'FAULT', 'INSPECTION']);
const statusEnum = z.enum(['PLANNED', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'DONE', 'CANCELLED']);
const priorityEnum = z.enum(['LOW', 'NORMAL', 'HIGH', 'CRITICAL']);

const emptyToUndef = (v: unknown) => (v === '' || v === null ? undefined : v);

const updateSchema = z.object({
  type: typeEnum.optional(),
  status: statusEnum.optional(),
  title: z.string().trim().min(1).max(200).optional(),
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
  partsUsedText: z.string().max(2000).optional().nullable(),
});

export const PUT = withMutation(
  async (request: NextRequest, { params }: { params: Promise<{ id: string; recordId: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    assertCan(user!, 'maintenance.manage');

    const { id, recordId } = await params;
    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID ?? '';
    const body = await request.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.issues.map((e) => ({ field: e.path.join('.'), message: e.message })) },
        { status: 400 }
      );
    }

    try {
      const record = await updateMaintenance(id, recordId, parsed.data, { tenantId, userId: user!.id });
      return NextResponse.json({ record });
    } catch (err) {
      if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
  },
  { domain: 'equipment.maintenance' }
);

export const DELETE = withMutation(
  async (request: NextRequest, { params }: { params: Promise<{ id: string; recordId: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    assertCan(user!, 'maintenance.manage');

    const { id, recordId } = await params;
    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID ?? '';
    try {
      await deleteMaintenance(id, recordId, { tenantId });
      return NextResponse.json({ ok: true });
    } catch (err) {
      if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
  },
  { domain: 'equipment.maintenance' }
);
