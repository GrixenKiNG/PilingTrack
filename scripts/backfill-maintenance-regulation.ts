/**
 * Разовый пересчёт регламентов ТО по уже закрытым нарядам.
 *
 * Зачем. До 14.08.2026 закрытие наряда ТО не отмечалось в регламенте
 * (`MaintenancePlan.lastDoneHours/lastDoneAt`) и не двигало пороги в карточке
 * техники. Новый код это делает — но только для нарядов, закрытых после его
 * выката. Историю он не переписывает: техника, где ТО фактически выполнялось,
 * так и останется с порогом времён последней ручной правки.
 *
 * Что делает скрипт. Для каждого активного регламента ищет ПОСЛЕДНИЙ закрытый
 * наряд того же типа и переносит из него факт выполнения в регламент. Затем
 * пересчитывает ближайший срок по технике — тем же кодом, что и рабочий путь
 * (`projectNextMaintenance`), чтобы результат совпадал с обычным закрытием ТО.
 *
 * ⚠️ Чего скрипт НЕ делает — и это принципиально: он не объявляет ТО
 * выполненным. Если по регламенту ТО действительно просрочено (наряды не
 * закрывались или моточасы ушли далеко за порог), после пересчёта оно так и
 * останется просроченным. «Погасить» такую технику может только фактически
 * выполненное и закрытое ТО. Скрипт лишь приводит пороги в соответствие с тем,
 * что уже записано в нарядах.
 *
 * Запуск:
 *   npx tsx scripts/backfill-maintenance-regulation.ts            # только показать
 *   npx tsx scripts/backfill-maintenance-regulation.ts --apply    # записать
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/postgres-client';
import { projectNextMaintenance } from '../src/modules/equipment/application/commands/maintenance-regulation';

/** Наряды, которые считаются фактически выполненными. */
const CLOSED_STATUSES = ['DONE'] as const;

async function main() {
  const apply = process.argv.includes('--apply');
  const connectionString = process.env.DATABASE_URL_POSTGRES || process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL_POSTGRES (или DATABASE_URL) обязателен');
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  const now = new Date();
  const plans = await db.maintenancePlan.findMany({
    where: { isActive: true },
    select: {
      id: true, tenantId: true, equipmentId: true, type: true, triggerType: true,
      intervalHours: true, intervalDays: true, leadTimeDays: true,
      lastDoneHours: true, lastDoneAt: true,
    },
  });
  if (plans.length === 0) {
    console.log('Активных регламентов нет — пересчитывать нечего.');
    await db.$disconnect();
    return;
  }

  const planUpdates: { id: string; lastDoneHours: number | null; lastDoneAt: Date }[] = [];

  for (const plan of plans) {
    const lastClosed = await db.maintenanceRecord.findFirst({
      where: {
        tenantId: plan.tenantId, equipmentId: plan.equipmentId, type: plan.type,
        status: { in: [...CLOSED_STATUSES] }, completedAt: { not: null },
      },
      orderBy: { completedAt: 'desc' },
      select: { completedAt: true, engineHoursAtService: true },
    });
    if (!lastClosed?.completedAt) continue;
    // Уже учтено — не трогаем: повторная запись того же факта только шумит в
    // журнале изменений.
    if (plan.lastDoneAt != null && plan.lastDoneAt >= lastClosed.completedAt) continue;

    const lastDoneHours = lastClosed.engineHoursAtService ?? plan.lastDoneHours;
    planUpdates.push({ id: plan.id, lastDoneHours, lastDoneAt: lastClosed.completedAt });
    plan.lastDoneHours = lastDoneHours;
    plan.lastDoneAt = lastClosed.completedAt;
  }

  // Проекция считается по ВСЕМ активным регламентам техники, а не только по
  // обновлённым: ближайший срок мог определяться соседним регламентом.
  const byEquipment = new Map<string, typeof plans>();
  for (const plan of plans) {
    const list = byEquipment.get(plan.equipmentId) ?? [];
    list.push(plan);
    byEquipment.set(plan.equipmentId, list);
  }

  const equipmentUpdates: {
    id: string; name: string;
    fromHours: number | null; toHours: number | null;
    fromDate: Date | null; toDate: Date | null;
    engineHoursTotal: number | null; stillOverdue: boolean;
  }[] = [];

  for (const [equipmentId, equipmentPlans] of byEquipment) {
    const equipment = await db.equipment.findUnique({
      where: { id: equipmentId },
      select: { id: true, name: true, engineHoursTotal: true, nextMaintenanceAtHours: true, nextMaintenanceDate: true },
    });
    if (!equipment) continue;

    const next = projectNextMaintenance(equipmentPlans, equipment.engineHoursTotal, now);
    const changedHours = next.nextMaintenanceAtHours != null
      && next.nextMaintenanceAtHours !== equipment.nextMaintenanceAtHours;
    const changedDate = next.nextMaintenanceDate != null
      && next.nextMaintenanceDate.getTime() !== equipment.nextMaintenanceDate?.getTime();
    if (!changedHours && !changedDate) continue;

    const targetHours = next.nextMaintenanceAtHours ?? equipment.nextMaintenanceAtHours;
    equipmentUpdates.push({
      id: equipment.id, name: equipment.name,
      fromHours: equipment.nextMaintenanceAtHours, toHours: next.nextMaintenanceAtHours,
      fromDate: equipment.nextMaintenanceDate, toDate: next.nextMaintenanceDate,
      engineHoursTotal: equipment.engineHoursTotal,
      stillOverdue: targetHours != null && equipment.engineHoursTotal != null
        && equipment.engineHoursTotal > targetHours,
    });
  }

  console.log(`\nРегламентов активно: ${plans.length}, техники с регламентами: ${byEquipment.size}`);
  console.log(`Регламентов получат отметку о выполнении: ${planUpdates.length}`);
  console.log(`Единиц техники со сдвигом порога: ${equipmentUpdates.length}\n`);

  for (const row of equipmentUpdates) {
    const hours = row.toHours != null ? `${row.fromHours ?? '—'} → ${row.toHours} м/ч` : 'по моточасам без изменений';
    const date = row.toDate != null
      ? `${row.fromDate?.toISOString().slice(0, 10) ?? '—'} → ${row.toDate.toISOString().slice(0, 10)}`
      : 'по календарю без изменений';
    const mark = row.stillOverdue ? '  ⚠️ ТО всё равно просрочено (наработка выше нового порога)' : '';
    console.log(`  ${row.name}: ${hours}; ${date}${mark}`);
  }

  if (!apply) {
    console.log('\nЭто предпросмотр. Чтобы записать: npx tsx scripts/backfill-maintenance-regulation.ts --apply\n');
    await db.$disconnect();
    return;
  }

  await db.$transaction(async (tx) => {
    for (const update of planUpdates) {
      await tx.maintenancePlan.update({
        where: { id: update.id },
        data: { lastDoneHours: update.lastDoneHours, lastDoneAt: update.lastDoneAt },
      });
    }
    for (const row of equipmentUpdates) {
      const data: { nextMaintenanceAtHours?: number; nextMaintenanceDate?: Date } = {};
      if (row.toHours != null) data.nextMaintenanceAtHours = row.toHours;
      if (row.toDate != null) data.nextMaintenanceDate = row.toDate;
      await tx.equipment.update({ where: { id: row.id }, data });
    }
  });

  console.log(`\nЗаписано: регламентов ${planUpdates.length}, техники ${equipmentUpdates.length}.`);
  const stillOverdue = equipmentUpdates.filter((row) => row.stillOverdue).length;
  if (stillOverdue > 0) {
    console.log(`⚠️ У ${stillOverdue} ед. техники ТО остаётся просроченным — это факт, а не ошибка пересчёта.`);
  }
  await db.$disconnect();
}

main().catch((error) => {
  console.error('Пересчёт оборван:', error);
  process.exit(1);
});
