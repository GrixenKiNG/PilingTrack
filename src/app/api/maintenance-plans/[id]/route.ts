import { NextRequest, NextResponse } from 'next/server';
import { requireTenantId } from '@/lib/tenant';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { updateMaintenancePlan, deleteMaintenancePlan } from '@/modules/equipment';
import { withMutation, readJsonBody } from '@/core/api-wrapper';
import { ServiceError } from '@/services/service-error';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { recordAuditEvent } from '@/services/audit/audit-service';

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
    const body = await readJsonBody(request);
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Некорректные данные', details: parsed.error.issues.map((e) => ({ field: e.path.join('.'), message: e.message })) },
        { status: 400 }
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const tenantId = requireTenantId(user!);
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
    const actor = user!;
    const tenantId = requireTenantId(actor);

    // Снимок регламента читается ДО удаления (F-R39-3): по исчезнувшему
    // регламенту потом разбирают, почему ТО не было запланировано, а самой
    // строки с названием и интервалом к тому моменту уже нет.
    const snapshot = await db.maintenancePlan.findFirst({
      where: { id, tenantId },
      select: {
        title: true,
        type: true,
        triggerType: true,
        intervalHours: true,
        intervalDays: true,
        equipment: { select: { name: true } },
      },
    });

    try {
      await deleteMaintenancePlan(id, { tenantId });
    } catch (err) {
      if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }

    // Best-effort (F-R39-3): регламент уже удалён — сбой записи следа не должен
    // превращать успешное удаление в 500 (как в reports/delete).
    try {
      await recordAuditEvent({
        action: 'maintenance.plan.deleted',
        scope: 'equipment',
        actorId: actor.id,
        targetId: id,
        tenantId,
        metadata: snapshot
          ? {
              name: snapshot.equipment.name,
              before: {
                title: snapshot.title,
                type: snapshot.type,
                triggerType: snapshot.triggerType,
                intervalHours: snapshot.intervalHours,
                intervalDays: snapshot.intervalDays,
              },
            }
          : undefined,
      });
    } catch (err) {
      logger.error('Maintenance plan delete: audit write failed', err, { planId: id });
    }

    return NextResponse.json({ success: true });
  },
  { domain: 'equipment.maintenance' }
);
