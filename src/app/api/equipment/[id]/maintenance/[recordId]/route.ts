import { NextRequest, NextResponse } from 'next/server';
import { requireTenantId } from '@/lib/tenant';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { updateMaintenance, deleteMaintenance } from '@/modules/equipment';
import { withMutation, readJsonBody } from '@/core/api-wrapper';
import { ServiceError } from '@/services/service-error';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { recordAuditEvent } from '@/services/audit/audit-service';

export const runtime = 'nodejs';

const typeEnum = z.enum(['EO', 'TO1', 'TO2', 'TO3', 'SEASONAL', 'REPAIR', 'FAULT', 'SCHEDULED', 'INSPECTION']);
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
  workDone: z.string().max(4000).optional().nullable(),
  partsUsedText: z.string().max(2000).optional().nullable(),
  cancelReason: z.string().max(2000).optional().nullable(),
});

export const PUT = withMutation(
  async (request: NextRequest, { params }: { params: Promise<{ id: string; recordId: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'maintenance.manage');

    const { id, recordId } = await params;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const actor = user!;
    const tenantId = requireTenantId(actor);
    const body = await readJsonBody(request);
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Некорректные данные', details: parsed.error.issues.map((e) => ({ field: e.path.join('.'), message: e.message })) },
        { status: 400 }
      );
    }

    // Снимок наряда читается ДО правки (F-R34-12): строка хранит только
    // последнее значение, и правку стоимости, трудозатрат или моточасов после
    // закрытия иначе не отличить от «никогда не меняли». Строго по тенанту и
    // по установке — как команда.
    const snapshot = await db.maintenanceRecord.findFirst({
      where: { id: recordId, equipmentId: id, tenantId },
      select: {
        status: true,
        cost: true,
        laborHours: true,
        engineHoursAtService: true,
        workDone: true,
        cancelReason: true,
      },
    });

    try {
      const record = await updateMaintenance(id, recordId, parsed.data, { tenantId, userId: actor.id });
      // Best-effort (F-R34-12): наряд уже изменён — сбой записи следа не должен
      // превращать успешную правку в 500 (как в reports/delete).
      try {
        await recordAuditEvent({
          action: 'maintenance.updated',
          scope: 'equipment',
          actorId: actor.id,
          targetId: recordId,
          tenantId,
          metadata: snapshot
            ? {
                name: record.title,
                before: snapshot,
                after: {
                  status: record.status,
                  cost: record.cost,
                  laborHours: record.laborHours,
                  engineHoursAtService: record.engineHoursAtService,
                  workDone: record.workDone,
                  cancelReason: record.cancelReason,
                },
              }
            : undefined,
        });
      } catch (err) {
        logger.error('Maintenance update: audit write failed', err, { recordId });
      }
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
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'maintenance.manage');

    const { id, recordId } = await params;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const actor = user!;
    const tenantId = requireTenantId(actor);

    // Снимок удаляемого наряда берётся из результата команды: `delete`
    // возвращает снятую строку (DELETE … RETURNING), поэтому отдельное чтение
    // ДО удаления не нужно — между ним и удалением наряд могли изменить, и в
    // ленту ушли бы старые значения (F-R72-FEED-b).
    let removed;
    try {
      removed = await deleteMaintenance(id, recordId, { tenantId });
    } catch (err) {
      if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }

    // Название установки команда не возвращает и от гонки не зависит — читается
    // отдельно, строго по тенанту и установке.
    const equipment = await db.equipment.findFirst({
      where: { id, tenantId },
      select: { name: true },
    });

    // Удаление наряда ТО не оставляло следа нигде, хотя создание, правка и
    // приёмка того же наряда писались (F-R72-FEED-METER-MAINT). Пишется только
    // после успешной команды.
    await recordAuditEvent({
      action: 'maintenance.record.deleted',
      scope: 'equipment',
      actorId: actor.id,
      targetId: recordId,
      tenantId,
      metadata: {
        name: removed.title,
        before: {
          type: removed.type,
          status: removed.status,
          scheduledAt: removed.scheduledAt,
          equipmentName: equipment?.name,
        },
      },
    });

    return NextResponse.json({ ok: true });
  },
  { domain: 'equipment.maintenance' }
);
