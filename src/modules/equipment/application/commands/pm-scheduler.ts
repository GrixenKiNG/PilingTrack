/**
 * PM scheduler (P3) — turns MaintenancePlan rules into due-status and, when a
 * plan enters its window, into a PLANNED work order. Runs on data we already
 * have: the meter-reading journal (HOURS) and the calendar (CALENDAR). No
 * telemetry/hardware required.
 *
 * evaluatePlanDue is pure (injected `now` + latest hours) so it's unit-testable;
 * runPmScheduler is the db-backed daily pass invoked by the worker.
 */

import { db } from '@/lib/db';
import { ServiceError } from '@/lib/service-error';
import { evaluatePlanDue } from '@/lib/pm-due';

export { evaluatePlanDue } from '@/lib/pm-due';
export type { PmTriggerType, PmDueStatus, PlanForEval, PlanDueResult } from '@/lib/pm-due';

const OPEN_STATUSES = ['PLANNED', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'] as const;

export interface PmSchedulerResult {
  evaluated: number;
  due: number;
  created: number;
}

/**
 * Daily pass: for every active plan, if it's due_soon/overdue and the rig has
 * no open work order of that type yet (dedup), create a PLANNED one. Returns a
 * summary. Tenant-scoped; safe to run repeatedly (idempotent via the dedup).
 */
export async function runPmScheduler(tenantId: string, now: Date = new Date()): Promise<PmSchedulerResult> {
  if (!tenantId) throw new ServiceError('tenantId is required', 400);

  const plans = await db.maintenancePlan.findMany({
    where: { tenantId, isActive: true },
    include: {
      equipment: {
        select: {
          id: true,
          engineHoursTotal: true,
          meterReadings: {
            orderBy: [{ recordedAt: 'desc' }, { createdAt: 'desc' }],
            take: 1,
            select: { engineHours: true },
          },
        },
      },
    },
  });

  let due = 0;
  let created = 0;

  for (const plan of plans) {
    const latestHours = plan.equipment.meterReadings[0]?.engineHours ?? plan.equipment.engineHoursTotal ?? null;
    const result = evaluatePlanDue(plan, latestHours, now);
    if (result.status === 'ok') continue;
    due++;

    // Dedup: skip if an open work order of this type already exists for the rig.
    const existingOpen = await db.maintenanceRecord.findFirst({
      where: {
        equipmentId: plan.equipmentId,
        tenantId,
        type: plan.type,
        status: { in: [...OPEN_STATUSES] },
      },
      select: { id: true },
    });
    if (existingOpen) continue;

    const dueLabel =
      result.status === 'overdue' ? 'просрочено' : 'подходит срок';
    await db.maintenanceRecord.create({
      data: {
        tenantId,
        equipmentId: plan.equipmentId,
        type: plan.type,
        status: 'PLANNED',
        title: `${plan.title} (${dueLabel})`,
        description: 'Создано планировщиком ТО по регламенту.',
        scheduledAt: result.dueDate ?? null,
      },
    });
    created++;
  }

  return { evaluated: plans.length, due, created };
}
