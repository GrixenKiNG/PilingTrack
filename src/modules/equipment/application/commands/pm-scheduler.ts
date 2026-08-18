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
import { requestReadinessSnapshot } from '@/modules/readiness/application/projection/request-snapshot';
import {
  runWithTenantContext,
  setRequestTenantId,
} from '@/core/security/tenant-context';

export { evaluatePlanDue } from '@/lib/pm-due';
export type { PmTriggerType, PmDueStatus, PlanForEval, PlanDueResult } from '@/lib/pm-due';

const OPEN_STATUSES = ['PLANNED', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'] as const;

export interface PmSchedulerResult {
  evaluated: number;
  due: number;
  created: number;
  /**
   * Просроченные регламенты — для оповещения. Порог берётся из самого
   * регламента (интервал плана), а не из правила готовности
   * MAINTENANCE_OVERDUE_50H: это разные вещи. Первое отвечает «работа
   * просрочена по нормативу», второе — «насколько сильно, чтобы влиять на
   * допуск». Планировщик знает интервал каждого плана и считает его ежедневно.
   */
  overdue: Array<{ equipmentId: string; title: string; hoursOverdue: number | null; daysOverdue: number | null }>;
}

/**
 * Daily pass: for every active plan, if it's due_soon/overdue and the rig has
 * no open work order of that type yet (dedup), create a PLANNED one. Returns a
 * summary. Tenant-scoped; safe to run repeatedly (idempotent via the dedup).
 */
export async function runPmScheduler(tenantId: string, now: Date = new Date()): Promise<PmSchedulerResult> {
  if (!tenantId) throw new ServiceError('tenantId is required', 400);

  // Планировщик запускается без запроса, поэтому контекст, который открывает
  // withApi, здесь не заведён — тенант известен только из параметра. Без этого
  // все запросы ниже уходят в базу «безымянными», и после перевода политик RLS
  // в fail-closed планировщик молча не нашёл бы ни одного плана.
  return runWithTenantContext(async () => {
    setRequestTenantId(tenantId);
    return runPmSchedulerScoped(tenantId, now);
  });
}

async function runPmSchedulerScoped(tenantId: string, now: Date): Promise<PmSchedulerResult> {

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
  const overdue: PmSchedulerResult['overdue'] = [];

  for (const plan of plans) {
    const latestHours = plan.equipment.meterReadings[0]?.engineHours ?? plan.equipment.engineHoursTotal ?? null;
    const result = evaluatePlanDue(plan, latestHours, now);
    if (result.status === 'ok') continue;
    due++;
    if (result.status === 'overdue') {
      overdue.push({
        equipmentId: plan.equipmentId,
        title: plan.title,
        hoursOverdue: result.hoursRemaining != null ? Math.abs(result.hoursRemaining) : null,
        daysOverdue: result.daysRemaining != null ? Math.abs(result.daysRemaining) : null,
      });
    }

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
    await db.$transaction(async (tx) => {
      const record = await tx.maintenanceRecord.create({
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
      // Планировщик открывает наряд без участия человека, и с этого момента
      // машина считается имеющей незакрытую работу. Балл готовности обязан
      // это увидеть, не дожидаясь следующего осмотра или запуска смены.
      await requestReadinessSnapshot(tx as typeof db, {
        tenantId,
        equipmentId: plan.equipmentId,
        aggregateId: record.id,
        aggregateType: 'MaintenanceRecord',
        triggerType: 'MAINTENANCE_CHANGED',
        triggerId: `${record.id}:scheduled:${record.updatedAt.toISOString()}`,
        occurredAt: record.updatedAt,
      });
    });
    created++;
  }

  return { evaluated: plans.length, due, created, overdue };
}
