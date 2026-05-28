/**
 * MaintenanceRecord CRUD.
 *
 * Tenant comes from ctx.tenantId. Existence checks for parent Equipment and
 * individual records are scoped to the same tenant (IDOR fix).
 */

import { db } from '@/lib/db';
import { ServiceError } from '@/services/service-error';

export type MaintenanceType = 'SCHEDULED' | 'REPAIR' | 'FAULT' | 'INSPECTION';
export type MaintenanceStatus = 'PLANNED' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';

export interface MaintenanceInput {
  type: MaintenanceType;
  status?: MaintenanceStatus;
  title: string;
  description?: string;
  scheduledAt?: string | Date | null;
  completedAt?: string | Date | null;
  engineHoursAtService?: number | null;
  cost?: number | null;
  performedBy?: string | null;
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
    },
  });
}

export async function updateMaintenance(
  equipmentId: string,
  recordId: string,
  input: Partial<MaintenanceInput>,
  ctx: { tenantId: string },
) {
  const existing = await db.maintenanceRecord.findUnique({
    where: { id: recordId },
    select: { id: true, equipmentId: true, completedAt: true, tenantId: true },
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

  if (input.status !== undefined) {
    data.status = input.status;
    if (input.status === 'DONE' && input.completedAt === undefined && !existing.completedAt) {
      data.completedAt = new Date();
    }
  }

  return db.maintenanceRecord.update({ where: { id: recordId }, data });
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
