/**
 * Заведение регламентов ТО по моточасам на весь парк.
 *
 * Зачем. Автоматический сдвиг сроков ТО работает только там, где заведён
 * регламент (`MaintenancePlan`). В базе он был ровно один на восемь единиц
 * техники — остальные жили на порогах, выставленных руками однажды, и
 * «ТО просрочено» у них не гасло никогда.
 *
 * Что заводит: два регламента по моточасам на каждую машину —
 *   ТО-1 каждые 250 м/ч
 *   ТО-2 каждые 500 м/ч
 * Оба активны: ближайшим всегда окажется тот, что наступает раньше. Лишний
 * можно отключить в карточке техники, не трогая код.
 *
 * ⚠️ Откуда берётся точка отсчёта — здесь важна честность:
 *   --start=last-service (по умолчанию) — от последнего ЗАКРЫТОГО наряда ТО
 *     этого типа. Если нарядов не было, регламент заводится без точки отсчёта:
 *     он ничего не считает и ложных «просрочено» не создаёт, пока первое ТО не
 *     будет закрыто в системе.
 *   --start=now — точка отсчёта = текущая наработка. Это операционное решение
 *     «с сегодняшнего дня считаем заново», а НЕ утверждение, что ТО выполнено:
 *     дата выполнения остаётся пустой. Выбирать осознанно.
 *
 * Запуск:
 *   npx tsx scripts/seed-maintenance-plans.ts                      # предпросмотр
 *   npx tsx scripts/seed-maintenance-plans.ts --apply
 *   npx tsx scripts/seed-maintenance-plans.ts --start=now --apply
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/postgres-client';

const REGULATIONS = [
  { type: 'TO1' as const, intervalHours: 250, title: 'ТО-1 (каждые 250 м/ч)' },
  { type: 'TO2' as const, intervalHours: 500, title: 'ТО-2 (каждые 500 м/ч)' },
];

async function main() {
  const apply = process.argv.includes('--apply');
  const startFromNow = process.argv.includes('--start=now');
  const connectionString = process.env.DATABASE_URL_POSTGRES || process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL_POSTGRES (или DATABASE_URL) обязателен');
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  const fleet = await db.equipment.findMany({
    where: { isActive: true },
    select: { id: true, tenantId: true, name: true, engineHoursTotal: true },
    orderBy: { name: 'asc' },
  });

  const planned: {
    equipmentId: string; tenantId: string; name: string; type: 'TO1' | 'TO2';
    title: string; intervalHours: number; lastDoneHours: number | null; source: string;
  }[] = [];
  let alreadyHave = 0;

  for (const machine of fleet) {
    for (const regulation of REGULATIONS) {
      const existing = await db.maintenancePlan.findFirst({
        where: { tenantId: machine.tenantId, equipmentId: machine.id, type: regulation.type, isActive: true },
        select: { id: true },
      });
      if (existing) { alreadyHave += 1; continue; }

      const lastClosed = await db.maintenanceRecord.findFirst({
        where: {
          tenantId: machine.tenantId, equipmentId: machine.id, type: regulation.type,
          status: 'DONE', engineHoursAtService: { not: null },
        },
        orderBy: { completedAt: 'desc' },
        select: { engineHoursAtService: true },
      });

      const lastDoneHours = lastClosed?.engineHoursAtService
        ?? (startFromNow ? machine.engineHoursTotal : null);
      const source = lastClosed?.engineHoursAtService != null
        ? 'по закрытому наряду'
        : startFromNow ? 'от текущей наработки' : 'без точки отсчёта';

      planned.push({
        equipmentId: machine.id, tenantId: machine.tenantId, name: machine.name,
        type: regulation.type, title: regulation.title,
        intervalHours: regulation.intervalHours, lastDoneHours, source,
      });
    }
  }

  console.log(`\nТехники активной: ${fleet.length}`);
  console.log(`Регламентов уже есть: ${alreadyHave}`);
  console.log(`Будет заведено: ${planned.length}\n`);
  for (const row of planned) {
    const start = row.lastDoneHours != null ? `отсчёт от ${row.lastDoneHours} м/ч` : 'отсчёта нет';
    console.log(`  ${row.name} — ${row.title}: ${start} (${row.source})`);
  }

  if (!apply) {
    console.log('\nЭто предпросмотр. Записать: добавьте --apply\n');
    await db.$disconnect();
    return;
  }

  await db.$transaction(
    planned.map((row) => db.maintenancePlan.create({
      data: {
        tenantId: row.tenantId, equipmentId: row.equipmentId, title: row.title,
        type: row.type, triggerType: 'HOURS', intervalHours: row.intervalHours,
        leadTimeDays: 7, lastDoneHours: row.lastDoneHours, isActive: true,
      },
    })),
  );

  console.log(`\nЗаведено регламентов: ${planned.length}.`);
  console.log('Дальше: npx tsx scripts/backfill-maintenance-regulation.ts — он пересчитает пороги.\n');
  await db.$disconnect();
}

main().catch((error) => {
  console.error('Заведение регламентов оборвано:', error);
  process.exit(1);
});
