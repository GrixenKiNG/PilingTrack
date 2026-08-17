/**
 * Проверка модуля техготовности на настоящих данных.
 *
 * Зачем. Юнит-тесты проверяют правила на выдуманных фактах, а вопрос обычно
 * другой: «модуль считает то, что заложено, на нашей технике?». Скрипт берёт
 * действующий опубликованный набор правил тенанта, прогоняет авторитетный
 * расчёт по каждой машине и печатает рядом ФАКТЫ из базы и ВЫВОД оценщика —
 * чтобы одно можно было сверить с другим глазами.
 *
 * Ничего не меняет: единственная запись (проверка сдвига регламента ТО) идёт
 * в транзакции, которая заведомо откатывается.
 *
 * Запуск: npx tsx scripts/verify-readiness.ts
 */
import 'dotenv/config';
import { db } from '../src/lib/db';
import { withReadinessTenantTransaction } from '../src/modules/readiness/infrastructure/tenant-transaction';
import { evaluateAuthoritativeReadiness } from '../src/modules/readiness/application/readiness-score';
import { capturedClock } from '../src/modules/readiness/domain/evaluation/clock';
import { advanceMaintenanceRegulation } from '../src/modules/equipment/application/commands/maintenance-regulation';

const TENANT = process.env.DEFAULT_TENANT_ID || 'orion';
const TIMEZONE = 'Europe/Moscow';

class Rollback extends Error {}

async function main() {
  const now = new Date();
  console.log(`\nТенант: ${TENANT}   Время расчёта: ${now.toISOString()}\n`);

  const rules = await db.readinessRuleSet.findFirst({
    where: { tenantId: TENANT, status: 'PUBLISHED' },
    orderBy: { updatedAt: 'desc' },
  });
  console.log('=== 1. Действующие правила (то, по чему считает модуль) ===');
  if (!rules) {
    console.log('  Опубликованного набора нет — расчёт пойдёт без правил.\n');
  } else {
    console.log(`  Версия ${rules.version}, опубликована ${rules.publishedAt?.toISOString().slice(0, 16) ?? '—'}`);
    for (const blocker of rules.blockers as Array<{ condition: string; action: string; isActive: boolean }>) {
      const state = blocker.isActive ? blocker.action : 'выключено';
      console.log(`    ${blocker.condition.padEnd(28)} ${state}`);
    }
    const weights = (rules.criteria as Array<{ key: string; weight: number }>)
      .map((c) => `${c.key} ${c.weight}`).join(', ');
    console.log(`  Веса критериев: ${weights}`);
  }

  const fleet = await db.equipment.findMany({
    where: { tenantId: TENANT, isActive: true },
    select: { id: true, name: true, engineHoursTotal: true, nextMaintenanceAtHours: true, nextMaintenanceDate: true },
    orderBy: { name: 'asc' },
  });

  console.log(`\n=== 2. Расчёт по технике (${fleet.length} ед.) ===`);
  for (const machine of fleet) {
    const evaluation = await withReadinessTenantTransaction(TENANT, (tx) =>
      evaluateAuthoritativeReadiness({
        tx, tenantId: TENANT, equipmentId: machine.id,
        timezone: TIMEZONE, clock: capturedClock(now),
      }));

    const overdue = machine.nextMaintenanceAtHours != null && machine.engineHoursTotal != null
      ? machine.engineHoursTotal - machine.nextMaintenanceAtHours : null;
    const f = evaluation.facts;
    console.log(`\n  ${machine.name}`);
    console.log(`    в базе: наработка ${machine.engineHoursTotal ?? '—'} м/ч, порог ТО ${machine.nextMaintenanceAtHours ?? '—'}`
      + (overdue != null && overdue > 0 ? `, перепробег ${overdue} м/ч` : ''));
    console.log(`    модуль прочитал: осмотр сегодня ${f.inspectionCompleted ? 'да' : 'нет'}`
      + ` (готовность ${Math.round(f.inspectionProgress * 100)}%, оценка ${f.healthScore ?? '—'})`
      + `, моточасы ${f.meterKnown ? 'известны' : 'неизвестны'}`
      + `, наряд ${f.permitValid ? 'действует' : f.permitExpired ? 'просрочен' : 'нет'}`
      + `, ТО ${f.maintenanceConfigured ? `перепробег ${f.maintenanceOverdueHours} м/ч / ${f.maintenanceOverdueDays} дн.` : 'регламент не настроен'}`
      + `, критический дефект ${f.criticalDefect ? 'есть' : 'нет'}`
      + `, приёмка ${f.accepted ? 'есть' : 'нет'}`);
    console.log(`    вывод: балл ${evaluation.score}, вердикт ${evaluation.verdict}, запуск ${evaluation.allowed ? 'РАЗРЕШЁН' : 'ЗАПРЕЩЁН'}`);
    if (evaluation.blockers.length) {
      console.log(`    блокеры: ${evaluation.blockers.map((b: { label: string }) => b.label).join(', ')}`);
    }
    if (evaluation.warnings.length) {
      console.log(`    замечания: ${evaluation.warnings.map((w: { message: string }) => w.message).join(', ')}`);
    }
  }

  console.log('\n=== 3. Сдвиг регламента ТО при закрытии наряда (запись откатывается) ===');
  const planned = await db.maintenancePlan.findFirst({
    where: { tenantId: TENANT, isActive: true, triggerType: 'HOURS', intervalHours: { not: null } },
    select: { id: true, equipmentId: true, type: true, intervalHours: true, lastDoneHours: true },
  });
  if (!planned) {
    console.log('  Регламентов по моточасам нет — проверять нечего.');
  } else {
    const machine = await db.equipment.findUnique({
      where: { id: planned.equipmentId },
      select: { name: true, engineHoursTotal: true, nextMaintenanceAtHours: true },
    });
    const before = machine?.nextMaintenanceAtHours ?? null;
    // Закрываем наряд на 100 м/ч ВЫШЕ текущей наработки: если подставить
    // текущую, порог совпадёт с уже посчитанным, и проверка покажет «без
    // изменений» — не потому что сдвиг не работает, а потому что сдвигать
    // нечего. Такая проверка ничего не доказывает.
    const serviceHours = (machine?.engineHoursTotal ?? 0) + 100;
    let after: number | null = null;
    try {
      await db.$transaction(async (tx) => {
        await advanceMaintenanceRegulation(tx as typeof db, {
          tenantId: TENANT, equipmentId: planned.equipmentId,
          record: { type: planned.type, engineHoursAtService: serviceHours, completedAt: now },
        });
        const updated = await tx.equipment.findUnique({
          where: { id: planned.equipmentId }, select: { nextMaintenanceAtHours: true },
        });
        after = updated?.nextMaintenanceAtHours ?? null;
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
    const restored = await db.equipment.findUnique({
      where: { id: planned.equipmentId }, select: { nextMaintenanceAtHours: true },
    });
    console.log(`  ${machine?.name}: наработка ${machine?.engineHoursTotal ?? '—'} м/ч, интервал ${planned.intervalHours} м/ч`);
    console.log(`  наряд закрыт на ${serviceHours} м/ч`);
    console.log(`  порог до закрытия: ${before ?? '—'}  →  после закрытия: ${after ?? '—'} (ожидаем ${serviceHours + (planned.intervalHours ?? 0)})`);
    console.log(`  после отката в базе: ${restored?.nextMaintenanceAtHours ?? '—'} (должно совпасть с «до»)`);
  }

  console.log('\n=== 4. Fail-closed по таблицам техготовности ===');
  const [{ role }] = await db.$queryRaw<Array<{ role: string; super: boolean }>>`
    SELECT current_user AS role, rolsuper AS super FROM pg_roles WHERE rolname = current_user`;
  const [{ super: isSuper }] = await db.$queryRaw<Array<{ super: boolean }>>`
    SELECT rolsuper AS super FROM pg_roles WHERE rolname = current_user`;
  const noTenant = await db.shift.count();
  const withTenant = await withReadinessTenantTransaction(TENANT, (tx) => tx.shift.count());
  console.log(`  роль соединения: ${role}${isSuper ? ' (СУПЕРПОЛЬЗОВАТЕЛЬ)' : ''}`);
  console.log(`  смен видно без тенанта: ${noTenant}, внутри обёртки: ${withTenant}`);
  if (isSuper) {
    console.log('  ⚠️ Суперпользователь обходит RLS всегда — здесь эта проверка НИЧЕГО не доказывает.');
    console.log('     Настоящая проверка: scripts/app-role-verify.sql под ролью pilingtrack_app.');
  } else if (noTenant === 0) {
    console.log('  ✅ Без тенанта строки не видны — fail-closed работает.');
  } else {
    console.log('  ❌ Без тенанта строки видны — политика не сработала.');
  }
  console.log('');

  await db.$disconnect();
}

main().catch(async (error) => {
  console.error('Проверка оборвана:', error);
  await db.$disconnect().catch(() => {});
  process.exit(1);
});
