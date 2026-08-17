/**
 * MaintenanceRecord CRUD.
 *
 * Tenant comes from ctx.tenantId. Existence checks for parent Equipment and
 * individual records are scoped to the same tenant (IDOR fix).
 */

import { db } from '@/lib/db';
import { ServiceError } from '@/lib/service-error';
import { requestReadinessSnapshot } from '@/modules/readiness/application/projection/request-snapshot';
import { OPEN_MAINTENANCE } from '@/modules/readiness/application/readiness-score';
import { advanceMaintenanceRegulation } from './maintenance-regulation';

const OPEN_MAINTENANCE_STATUSES = new Set<string>(OPEN_MAINTENANCE);

export type MaintenanceType = 'EO' | 'TO1' | 'TO2' | 'TO3' | 'SEASONAL' | 'REPAIR' | 'FAULT' | 'SCHEDULED' | 'INSPECTION';
export type MaintenanceStatus = 'PLANNED' | 'ASSIGNED' | 'IN_PROGRESS' | 'ON_HOLD' | 'DONE' | 'CANCELLED';
export type MaintenancePriority = 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';

export interface MaintenanceInput {
  type: MaintenanceType;
  status?: MaintenanceStatus;
  priority?: MaintenancePriority;
  title: string;
  description?: string;
  scheduledAt?: string | Date | null;
  completedAt?: string | Date | null;
  startedAt?: string | Date | null;
  engineHoursAtService?: number | null;
  laborHours?: number | null;
  cost?: number | null;
  performedBy?: string | null;
  assigneeId?: string | null;
  faultCause?: string | null;     // стадия 1: диагностика
  workDone?: string | null;       // стадия 2: выполненные работы
  partsUsedText?: string | null;
  cancelReason?: string | null;   // обязательна при переводе в CANCELLED
}

const toDate = (v: string | Date | null | undefined): Date | null => {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

export async function createMaintenance(
  equipmentId: string,
  input: MaintenanceInput,
  ctx: { tenantId: string; createdById?: string | null },
) {
  const equipment = await db.equipment.findUnique({
    where: { id: equipmentId, tenantId: ctx.tenantId },
    select: { id: true },
  });
  if (!equipment) throw new ServiceError('Equipment not found', 404);

  const status = input.status ?? 'PLANNED';
  const completedAt = toDate(input.completedAt) ?? (status === 'DONE' ? new Date() : null);
  const startedAt = toDate(input.startedAt) ?? (status === 'IN_PROGRESS' ? new Date() : null);

  return db.$transaction(async (tx) => {
    const record = await tx.maintenanceRecord.create({
      data: {
        tenantId: ctx.tenantId,
        equipmentId: equipment.id,
        type: input.type,
        status,
        title: input.title.trim(),
        description: input.description?.trim() ?? '',
        scheduledAt: toDate(input.scheduledAt),
        completedAt,
        engineHoursAtService: input.engineHoursAtService ?? null,
        cost: input.cost ?? null,
        performedBy: input.performedBy?.trim() || null,
        createdById: ctx.createdById ?? null,
        priority: input.priority ?? 'NORMAL',
        assigneeId: input.assigneeId ?? null,
        startedAt,
        laborHours: input.laborHours ?? null,
        faultCause: input.faultCause?.trim() || null,
        workDone: input.workDone?.trim() ?? '',
        partsUsedText: input.partsUsedText?.trim() ?? '',
      },
    });
    await requestMaintenanceSnapshot(tx as typeof db, record, ctx.tenantId, 'created');
    return record;
  });
}

/**
 * Открытый наряд ТО — вход авторитетного расчёта готовности (критерий
 * «Обслуживание», 20 баллов; CRITICAL-ремонт вдобавок блокирует допуск).
 * Пока наряды не заказывали снимок, балл в «Технике» и в центре готовности
 * не двигался, сколько бы механик ни закрыл работ.
 *
 * triggerId привязан к updatedAt: повтор той же записи идемпотентен, а
 * следующее изменение статуса даёт новый снимок.
 */
async function requestMaintenanceSnapshot(
  tx: typeof db,
  record: { id: string; equipmentId: string; updatedAt: Date },
  tenantId: string,
  reason: 'created' | 'status-changed' | 'accepted' | 'deleted',
) {
  await requestReadinessSnapshot(tx, {
    tenantId,
    equipmentId: record.equipmentId,
    aggregateId: record.id,
    aggregateType: 'MaintenanceRecord',
    triggerType: 'MAINTENANCE_CHANGED',
    triggerId: `${record.id}:${reason}:${record.updatedAt.toISOString()}`,
    occurredAt: record.updatedAt,
  });
}

/**
 * Наряд нельзя закрыть, не написав, что сделано.
 *
 * До этой проверки закрытие было односторонним: статус переводили в DONE, а
 * поля «выполненные работы» оставались пустыми — на 2026-08-16 таких записей в
 * базе было 19 из 19. Наряд выглядел завершённым, но доказательства работы не
 * существовало: ни что чинили, ни чем. Регламент ТО при этом сдвигался, то
 * есть пустая запись гасила «ТО просрочено» в готовности.
 *
 * Разблокировка очевидна и делается там же, где возникла ошибка: заполнить
 * «Стадия 2 — выполненные работы» в карточке наряда.
 */
function assertWorkDescribed(workDone: string | null | undefined): void {
  if ((workDone ?? '').trim() !== '') return;
  throw new ServiceError(
    'Нельзя закрыть наряд, не описав выполненные работы: заполните «Стадия 2 — выполненные работы»',
    422,
  );
}

/**
 * Отмена — такое же завершение наряда, как закрытие, и требует объяснения.
 *
 * Без него отменённый наряд неотличим от потерянного: заявка была, работы нет,
 * причины нет, спросить не с кого. Причина остаётся в записи и видна в
 * карточке рядом с тем, кто отменил.
 */
function assertCancelExplained(reason: string | null | undefined): void {
  if ((reason ?? '').trim() !== '') return;
  throw new ServiceError('Нельзя отменить наряд без причины: укажите, почему работа не нужна', 422);
}

export async function updateMaintenance(
  equipmentId: string,
  recordId: string,
  input: Partial<MaintenanceInput>,
  ctx: { tenantId: string; userId?: string | null },
) {
  const existing = await db.maintenanceRecord.findUnique({
    where: { id: recordId },
    select: { id: true, equipmentId: true, completedAt: true, startedAt: true, tenantId: true, acceptedById: true, status: true, workDone: true, cancelReason: true },
  });
  if (!existing || existing.equipmentId !== equipmentId || existing.tenantId !== ctx.tenantId) {
    throw new ServiceError('Maintenance record not found', 404);
  }
  // Accepted records are a closed financial/audit record — acceptMaintenance
  // is the deliberate "lock it" step; allowing edits afterwards defeats that.
  if (existing.acceptedById) {
    throw new ServiceError('Запись уже принята, изменения недоступны', 409);
  }

  const data: Record<string, unknown> = {};
  if (input.type !== undefined) data.type = input.type;
  if (input.title !== undefined) data.title = input.title.trim();
  if (input.description !== undefined) data.description = input.description?.trim() ?? '';
  if (input.scheduledAt !== undefined) data.scheduledAt = toDate(input.scheduledAt);
  if (input.engineHoursAtService !== undefined) data.engineHoursAtService = input.engineHoursAtService ?? null;
  if (input.cost !== undefined) data.cost = input.cost ?? null;
  if (input.performedBy !== undefined) data.performedBy = input.performedBy?.trim() || null;
  if (input.completedAt !== undefined) data.completedAt = toDate(input.completedAt);
  if (input.priority !== undefined) data.priority = input.priority;
  if (input.assigneeId !== undefined) data.assigneeId = input.assigneeId ?? null;
  if (input.laborHours !== undefined) data.laborHours = input.laborHours ?? null;
  if (input.faultCause !== undefined) data.faultCause = input.faultCause?.trim() || null;
  if (input.workDone !== undefined) data.workDone = input.workDone?.trim() ?? '';
  if (input.partsUsedText !== undefined) data.partsUsedText = input.partsUsedText?.trim() ?? '';
  if (input.cancelReason !== undefined) data.cancelReason = input.cancelReason?.trim() || null;
  if (input.startedAt !== undefined) data.startedAt = toDate(input.startedAt);

  if (input.status !== undefined) {
    data.status = input.status;
    if (input.status === 'IN_PROGRESS' && !existing.startedAt && input.startedAt === undefined) {
      data.startedAt = new Date();
    }
    if (input.status === 'DONE') {
      assertWorkDescribed(input.workDone ?? existing.workDone);
      if (input.completedAt === undefined && !existing.completedAt) data.completedAt = new Date();
      data.closedById = ctx.userId ?? null;
    }
    if (input.status === 'CANCELLED') {
      assertCancelExplained(input.cancelReason ?? existing.cancelReason);
      // Отменивший — тот же «кто закрыл»: наряд снят с работы этим человеком.
      data.closedById = ctx.userId ?? null;
    }
  }

  const statusChanged = input.status !== undefined && input.status !== existing.status;
  return db.$transaction(async (tx) => {
    const record = await tx.maintenanceRecord.update({ where: { id: recordId }, data });
    // Закрытый наряд двигает регламент — иначе моточасы растут, порог стоит,
    // и «ТО просрочено» в готовности не гаснет никогда.
    if (data.status === 'DONE') {
      await advanceMaintenanceRegulation(tx as typeof db, {
        tenantId: ctx.tenantId, equipmentId: record.equipmentId, record,
      });
    }
    // Пересчитываем только на смене статуса: правка заголовка или стоимости
    // на готовность не влияет, а лишний снимок засоряет доказательный журнал.
    if (statusChanged) await requestMaintenanceSnapshot(tx as typeof db, record, ctx.tenantId, 'status-changed');
    return record;
  });
}

/**
 * Accept a finished work order («Принять»). Admin-only at the route layer.
 * Stamps acceptedBy/acceptedAt, closes the record. Idempotency: rejects if
 * already accepted. Tenant-scoped, fail-closed.
 */
export async function acceptMaintenance(
  recordId: string,
  ctx: { tenantId: string; userId: string },
) {
  if (!ctx.tenantId) throw new ServiceError('tenantId is required', 400);
  const existing = await db.maintenanceRecord.findUnique({
    where: { id: recordId },
    select: { id: true, tenantId: true, acceptedById: true, completedAt: true, workDone: true },
  });
  if (!existing || existing.tenantId !== ctx.tenantId) {
    throw new ServiceError('Maintenance record not found', 404);
  }
  if (existing.acceptedById) throw new ServiceError('Запись уже принята', 409);
  // Приёмка переводит наряд в DONE напрямую, минуя updateMaintenance, — без
  // этой проверки пустой наряд закрывался бы через приёмку в обход правила.
  assertWorkDescribed(existing.workDone);

  return db.$transaction(async (tx) => {
    const record = await tx.maintenanceRecord.update({
      where: { id: recordId },
      data: {
        acceptedById: ctx.userId,
        acceptedAt: new Date(),
        status: 'DONE',
        closedById: ctx.userId,
        completedAt: existing.completedAt ?? new Date(),
      },
    });
    // Приёмка — второй проход по тому же наряду. Сдвиг регламента идемпотентен
    // (порог считается из записи, а не приращением), поэтому повтор безопасен и
    // страхует случай, когда наряд принят без явного перехода в DONE.
    await advanceMaintenanceRegulation(tx as typeof db, {
      tenantId: ctx.tenantId, equipmentId: record.equipmentId, record,
    });
    await requestMaintenanceSnapshot(tx as typeof db, record, ctx.tenantId, 'accepted');
    return record;
  });
}

export async function deleteMaintenance(
  equipmentId: string,
  recordId: string,
  ctx: { tenantId: string },
) {
  const existing = await db.maintenanceRecord.findUnique({
    where: { id: recordId },
    select: { id: true, equipmentId: true, tenantId: true, status: true },
  });
  if (!existing || existing.equipmentId !== equipmentId || existing.tenantId !== ctx.tenantId) {
    throw new ServiceError('Maintenance record not found', 404);
  }
  const wasOpen = OPEN_MAINTENANCE_STATUSES.has(existing.status);
  await db.$transaction(async (tx) => {
    await tx.maintenanceRecord.delete({ where: { id: recordId } });
    // Удаление закрытого наряда на готовность не влияет — она смотрит только
    // на открытые. Удаление открытого снимает нагрузку, снимок нужен.
    if (wasOpen) {
      await requestMaintenanceSnapshot(
        tx as typeof db,
        { id: recordId, equipmentId, updatedAt: new Date() },
        ctx.tenantId,
        'deleted',
      );
    }
  });
}
