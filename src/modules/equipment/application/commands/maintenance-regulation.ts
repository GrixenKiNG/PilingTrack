/**
 * Сдвиг регламента ТО при закрытии наряда.
 *
 * Было: `Equipment.nextMaintenanceAtHours` и `nextMaintenanceDate` писались
 * только из формы редактирования техники. Закрытие наряда ТО их не трогало, а
 * моточасы продолжали расти — значит перепробег `engineHoursTotal −
 * nextMaintenanceAtHours` только увеличивался, и критерий «Обслуживание» в
 * техготовности горел вечно, сколько ТО ни закрывай. Погасить его мог только
 * админ, вручную подвинув число в карточке.
 *
 * Стало: закрытый наряд отмечает факт выполнения в регламенте
 * (`MaintenancePlan.lastDoneHours/lastDoneAt`), а ближайший срок среди всех
 * активных регламентов техники проецируется в поля `Equipment`, откуда его
 * читает расчёт готовности (`readiness-score.ts`).
 *
 * Идемпотентно: значения считаются из самой записи наряда, а не приращением.
 * Поэтому «закрыл → принял» (два прохода по одному наряду) дают один и тот же
 * порог, а не сдвигают регламент дважды.
 *
 * Границы: техника без активных регламентов не трогается вовсе — там пороги
 * остаются ручными, как раньше. Наряды типов, на которые регламента нет
 * (REPAIR, FAULT), факт выполнения не отмечают, но проекцию обновляют: срок
 * мог сдвинуться из-за правки самого регламента.
 */

import { db } from '@/lib/db';
import { evaluatePlanDue, type PlanForEval } from '@/lib/pm-due';

/** Регламент в объёме, который нужен проекции. */
export type RegulationPlan = PlanForEval;

export interface NextMaintenance {
  nextMaintenanceAtHours: number | null;
  nextMaintenanceDate: Date | null;
}

/**
 * Ближайший срок среди регламентов. Чистая: считает только математику порогов,
 * повторно используя `evaluatePlanDue`, чтобы формула жила в одном месте.
 *
 * «Ближайший», а не «последний»: у техники бывает несколько регламентов (ТО-1
 * по моточасам, сезонное по календарю), и гореть должен тот, что наступает
 * раньше.
 */
export function projectNextMaintenance(
  plans: RegulationPlan[],
  latestHours: number | null,
  now: Date = new Date(),
): NextMaintenance {
  let nextMaintenanceAtHours: number | null = null;
  let nextMaintenanceDate: Date | null = null;

  for (const plan of plans) {
    const due = evaluatePlanDue(plan, latestHours, now);
    if (due.targetHours != null && (nextMaintenanceAtHours == null || due.targetHours < nextMaintenanceAtHours)) {
      nextMaintenanceAtHours = due.targetHours;
    }
    if (due.dueDate != null && (nextMaintenanceDate == null || due.dueDate < nextMaintenanceDate)) {
      nextMaintenanceDate = due.dueDate;
    }
  }

  return { nextMaintenanceAtHours, nextMaintenanceDate };
}

interface ClosedRecord {
  type: string;
  engineHoursAtService: number | null;
  completedAt: Date | null;
}

/**
 * Отметить выполнение в регламентах техники и пересчитать ближайший срок.
 * Вызывается внутри транзакции команды ТО — вместе с самой записью наряда.
 */
export async function advanceMaintenanceRegulation(
  tx: typeof db,
  input: { tenantId: string; equipmentId: string; record: ClosedRecord; now?: Date },
): Promise<void> {
  const plans = await tx.maintenancePlan.findMany({
    where: { tenantId: input.tenantId, equipmentId: input.equipmentId, isActive: true },
    select: {
      id: true, type: true, triggerType: true, intervalHours: true, intervalDays: true,
      leadTimeDays: true, lastDoneHours: true, lastDoneAt: true,
    },
  });
  if (plans.length === 0) return;

  const equipment = await tx.equipment.findFirst({
    where: { id: input.equipmentId, tenantId: input.tenantId },
    select: { engineHoursTotal: true },
  });
  const now = input.now ?? new Date();
  const doneHours = input.record.engineHoursAtService ?? equipment?.engineHoursTotal ?? null;
  const doneAt = input.record.completedAt ?? now;

  for (const plan of plans) {
    if (plan.type !== input.record.type) continue;
    // Локальная копия обновляется тоже: проекция ниже должна видеть новый факт,
    // а не то, что лежало в базе до закрытия наряда.
    if (doneHours != null) plan.lastDoneHours = doneHours;
    plan.lastDoneAt = doneAt;
    await tx.maintenancePlan.update({
      where: { id: plan.id },
      data: { lastDoneHours: plan.lastDoneHours, lastDoneAt: doneAt },
    });
  }

  const next = projectNextMaintenance(plans, equipment?.engineHoursTotal ?? doneHours, now);
  // Пустую проекцию не пишем: у регламента может не быть данных для расчёта
  // (не заполнен интервал), и обнулять руками выставленный порог нельзя.
  const data: Partial<NextMaintenance> = {};
  if (next.nextMaintenanceAtHours != null) data.nextMaintenanceAtHours = next.nextMaintenanceAtHours;
  if (next.nextMaintenanceDate != null) data.nextMaintenanceDate = next.nextMaintenanceDate;
  if (Object.keys(data).length === 0) return;

  await tx.equipment.update({ where: { id: input.equipmentId }, data });
}
