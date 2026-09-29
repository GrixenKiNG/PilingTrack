import { NextRequest, NextResponse } from 'next/server';
import { requireTenantId } from '@/lib/tenant';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { canDecreaseMeter, getEquipmentByIdOrThrow, updateEquipment, updateEquipmentMetadata, deleteEquipment } from '@/modules/equipment';
import { equipmentManageSchema } from '@/lib/validation-schemas';
import { withApi, withMutation, readJsonBody } from '@/core/api-wrapper';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { recordAuditEvent } from '@/services/audit/audit-service';

export const runtime = 'nodejs';

/**
 * Поля карточки установки, которые попадают в след (F-R34-14).
 *
 * Паспорт и характеристики правит `updateEquipmentMetadata`: их дифф сводился
 * бы к перечислению технических ключей, а в ленте нужно видеть название, модель
 * и статус работы — то, что владелец читает на экране.
 */
const AUDITED_EQUIPMENT_FIELDS = ['name', 'model', 'description', 'qty', 'isActive'] as const;

interface EquipmentAuditSnapshot {
  name: string;
  model: string;
  description: string;
  qty: number;
  isActive: boolean;
}

/** before/after только тех полей, что действительно изменились. */
function changedEquipmentFields(before: EquipmentAuditSnapshot | null, after: EquipmentAuditSnapshot) {
  const prev: Record<string, unknown> = {};
  const next: Record<string, unknown> = {};
  for (const field of AUDITED_EQUIPMENT_FIELDS) {
    const from = before ? before[field] : undefined;
    const to = after[field];
    if (from === to) continue;
    prev[field] = from ?? null;
    next[field] = to;
  }
  return { before: prev, after: next };
}

export const GET = withApi(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    const { id } = await params;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const tenantId = requireTenantId(user!);
    const equipment = await getEquipmentByIdOrThrow(id, tenantId);
    return NextResponse.json({ equipment });
  },
  { domain: 'equipment' }
);

export const PUT = withMutation(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'equipment.manage');
    const { id } = await params;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const tenantId = requireTenantId(user!);
    const body = await readJsonBody(request);

    const validation = equipmentManageSchema.partial().safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Некорректные данные', details: validation.error.issues.map(e => ({ field: e.path.join('.'), message: e.message })) },
        { status: 400 }
      );
    }

    // Снимок «до» читается перед изменением (F-R34-14): после `update` прежних
    // значений взять уже негде, а по ним видно, что именно поправили. Строго по
    // тенанту, как и сама команда.
    const before = await db.equipment.findFirst({
      where: { id, tenantId },
      select: { name: true, model: true, description: true, qty: true, isActive: true },
    });

    await updateEquipment({
      equipmentId: id,
      name: validation.data.name,
      model: validation.data.model,
      qty: validation.data.qty,
      description: validation.data.description,
      isActive: validation.data.isActive,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
      userId: user!.id,
      tenantId,
    });

    await updateEquipmentMetadata(id, validation.data, {
      tenantId,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
      actorId: user!.id,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
      allowDecrease: canDecreaseMeter(user!.role),
    });

    const equipment = await getEquipmentByIdOrThrow(id, tenantId);

    // След правки (F-R34-14): у выведенной из эксплуатации установки он
    // отдельный (`equipment.retired`) — она перестаёт допускаться к работе, и
    // «изменён статус» в ленте этого не сообщает. В before/after попадают
    // только те поля, что действительно изменились.
    const changed = changedEquipmentFields(before, equipment);
    const retired = before?.isActive === true && equipment.isActive === false;
    await recordAuditEvent({
      action: retired ? 'equipment.retired' : 'equipment.updated',
      scope: 'equipment',
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
      actorId: user!.id,
      targetId: id,
      tenantId,
      metadata: { name: equipment.name, before: changed.before, after: changed.after },
    });

    return NextResponse.json({ equipment });
  },
  { domain: 'equipment' }
);

export const DELETE = withMutation(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'equipment.manage');
    const { id } = await params;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const actor = user!;
    const tenantId = requireTenantId(actor);

    // Снимок удаляемой карточки читается ДО удаления (F-R34-14): строки после
    // `delete` уже нет, а «удалена установка» без названия и модели ничего не
    // сообщает. Строго по тенанту, как и сама команда.
    const snapshot = await db.equipment.findFirst({
      where: { id, tenantId },
      select: { name: true, model: true, kind: true, isActive: true },
    });

    const result = await deleteEquipment(id, tenantId);

    // Best-effort (F-R34-14): карточка уже удалена — сбой записи следа не должен
    // превращать успешное удаление в 500, иначе админ повторит запрос и получит
    // 404 по уже удалённой установке.
    try {
      await recordAuditEvent({
        action: 'equipment.deleted',
        scope: 'equipment',
        actorId: actor.id,
        targetId: id,
        tenantId,
        metadata: snapshot
          ? {
              name: snapshot.name,
              before: { model: snapshot.model, kind: snapshot.kind, isActive: snapshot.isActive },
            }
          : undefined,
      });
    } catch (err) {
      logger.error('Equipment delete: audit write failed', err, { equipmentId: id });
    }

    return NextResponse.json(result);
  },
  { domain: 'equipment' }
);
