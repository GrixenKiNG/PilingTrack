/**
 * MaintenancePlan CRUD (PM scheduler regламенты, P3).
 *
 * Tenant from ctx, fail-closed (IDOR guard). On create, lastDoneHours/lastDoneAt
 * default to "now" (current meter reading / current date) so the first interval
 * counts forward from today rather than firing immediately.
 */

import { db } from '@/lib/db';
import { ServiceError } from '@/lib/service-error';
import type { PmTriggerType } from './pm-scheduler';

export interface MaintenancePlanInput {
  equipmentId: string;
  title: string;
  type?: string;            // MaintenanceType — defaults to TO1
  triggerType: PmTriggerType;
  intervalHours?: number | null;
  intervalDays?: number | null;
  leadTimeDays?: number | null;
  lastDoneHours?: number | null;
  lastDoneAt?: string | Date | null;
}

const toDate = (v: string | Date | null | undefined): Date | null => {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

function assertTrigger(input: { triggerType: PmTriggerType; intervalHours?: number | null; intervalDays?: number | null }) {
  if (input.triggerType === 'HOURS' && (input.intervalHours == null || input.intervalHours <= 0)) {
    throw new ServiceError('Для регламента по моточасам задайте intervalHours > 0', 400);
  }
  if (input.triggerType === 'CALENDAR' && (input.intervalDays == null || input.intervalDays <= 0)) {
    throw new ServiceError('Для регламента по календарю задайте intervalDays > 0', 400);
  }
}

export async function createMaintenancePlan(input: MaintenancePlanInput, ctx: { tenantId: string }) {
  if (!ctx.tenantId) throw new ServiceError('tenantId is required', 400);
  assertTrigger(input);

  const equipment = await db.equipment.findUnique({
    where: { id: input.equipmentId, tenantId: ctx.tenantId },
    select: { id: true, engineHoursTotal: true },
  });
  if (!equipment) throw new ServiceError('Equipment not found', 404);

  // Anchor the first interval at "now" when the caller didn't supply a baseline.
  const lastDoneHours =
    input.lastDoneHours ?? (input.triggerType === 'HOURS' ? equipment.engineHoursTotal ?? 0 : null);
  const lastDoneAt =
    toDate(input.lastDoneAt) ?? (input.triggerType === 'CALENDAR' ? new Date() : null);

  return db.maintenancePlan.create({
    data: {
      tenantId: ctx.tenantId,
      equipmentId: input.equipmentId,
      title: input.title.trim(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- MaintenanceType enum cast at the command boundary
      type: (input.type as any) ?? 'TO1',
      triggerType: input.triggerType,
      intervalHours: input.triggerType === 'HOURS' ? input.intervalHours ?? null : null,
      intervalDays: input.triggerType === 'CALENDAR' ? input.intervalDays ?? null : null,
      leadTimeDays: input.leadTimeDays ?? 7,
      lastDoneHours,
      lastDoneAt,
    },
  });
}

export async function updateMaintenancePlan(
  planId: string,
  input: Partial<MaintenancePlanInput> & { isActive?: boolean },
  ctx: { tenantId: string },
) {
  if (!ctx.tenantId) throw new ServiceError('tenantId is required', 400);
  const existing = await db.maintenancePlan.findUnique({
    where: { id: planId },
    select: { id: true, tenantId: true, triggerType: true, intervalHours: true, intervalDays: true },
  });
  if (!existing || existing.tenantId !== ctx.tenantId) throw new ServiceError('Maintenance plan not found', 404);

  const triggerType = (input.triggerType ?? existing.triggerType) as PmTriggerType;
  assertTrigger({
    triggerType,
    intervalHours: input.intervalHours ?? existing.intervalHours,
    intervalDays: input.intervalDays ?? existing.intervalDays,
  });

  const data: Record<string, unknown> = {};
  if (input.title !== undefined) data.title = input.title.trim();
  if (input.type !== undefined) data.type = input.type;
  if (input.triggerType !== undefined) data.triggerType = input.triggerType;
  if (input.intervalHours !== undefined) data.intervalHours = input.intervalHours ?? null;
  if (input.intervalDays !== undefined) data.intervalDays = input.intervalDays ?? null;
  if (input.leadTimeDays !== undefined) data.leadTimeDays = input.leadTimeDays ?? 7;
  if (input.lastDoneHours !== undefined) data.lastDoneHours = input.lastDoneHours ?? null;
  if (input.lastDoneAt !== undefined) data.lastDoneAt = toDate(input.lastDoneAt);
  if (input.isActive !== undefined) data.isActive = input.isActive;

  return db.maintenancePlan.update({ where: { id: planId }, data });
}

export async function deleteMaintenancePlan(planId: string, ctx: { tenantId: string }) {
  if (!ctx.tenantId) throw new ServiceError('tenantId is required', 400);
  const existing = await db.maintenancePlan.findUnique({
    where: { id: planId },
    select: { id: true, tenantId: true },
  });
  if (!existing || existing.tenantId !== ctx.tenantId) throw new ServiceError('Maintenance plan not found', 404);
  await db.maintenancePlan.delete({ where: { id: planId } });
}
