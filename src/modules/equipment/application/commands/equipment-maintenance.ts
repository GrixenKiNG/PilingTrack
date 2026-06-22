/**
 * MaintenanceRecord CRUD.
 *
 * Tenant comes from ctx.tenantId. Existence checks for parent Equipment and
 * individual records are scoped to the same tenant (IDOR fix).
 */

import { db } from '@/lib/db';
import { ServiceError } from '@/lib/service-error';

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

  return db.maintenanceRecord.create({
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
}

export async function updateMaintenance(
  equipmentId: string,
  recordId: string,
  input: Partial<MaintenanceInput>,
  ctx: { tenantId: string; userId?: string | null },
) {
  const existing = await db.maintenanceRecord.findUnique({
    where: { id: recordId },
    select: { id: true, equipmentId: true, completedAt: true, startedAt: true, tenantId: true },
  });
  if (!existing || existing.equipmentId !== equipmentId || existing.tenantId !== ctx.tenantId) {
    throw new ServiceError('Maintenance record not found', 404);
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
  if (input.startedAt !== undefined) data.startedAt = toDate(input.startedAt);

  if (input.status !== undefined) {
    data.status = input.status;
    if (input.status === 'IN_PROGRESS' && !existing.startedAt && input.startedAt === undefined) {
      data.startedAt = new Date();
    }
    if (input.status === 'DONE') {
      if (input.completedAt === undefined && !existing.completedAt) data.completedAt = new Date();
      data.closedById = ctx.userId ?? null;
    }
  }

  return db.maintenanceRecord.update({ where: { id: recordId }, data });
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
    select: { id: true, tenantId: true, acceptedById: true, completedAt: true },
  });
  if (!existing || existing.tenantId !== ctx.tenantId) {
    throw new ServiceError('Maintenance record not found', 404);
  }
  if (existing.acceptedById) throw new ServiceError('Запись уже принята', 409);

  return db.maintenanceRecord.update({
    where: { id: recordId },
    data: {
      acceptedById: ctx.userId,
      acceptedAt: new Date(),
      status: 'DONE',
      closedById: ctx.userId,
      completedAt: existing.completedAt ?? new Date(),
    },
  });
}

export async function deleteMaintenance(
  equipmentId: string,
  recordId: string,
  ctx: { tenantId: string },
) {
  const existing = await db.maintenanceRecord.findUnique({
    where: { id: recordId },
    select: { id: true, equipmentId: true, tenantId: true },
  });
  if (!existing || existing.equipmentId !== equipmentId || existing.tenantId !== ctx.tenantId) {
    throw new ServiceError('Maintenance record not found', 404);
  }
  await db.maintenanceRecord.delete({ where: { id: recordId } });
}
