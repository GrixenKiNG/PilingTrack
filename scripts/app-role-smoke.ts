/**
 * Дымовая проверка роли pilingtrack_app на восстановленной копии базы.
 *
 * Зачем отдельно от app-role-verify.sql: тот скрипт проверяет права глазами
 * администратора (`SET ROLE`). Здесь же в базу ходит настоящий клиент
 * приложения — тот же Prisma, та же обёртка withReadinessTenantTransaction,
 * то же соединение, что будет у контейнера. Ровно этот путь и ломается, если
 * грант забыт: psql покажет «права есть», а приложение упадёт.
 *
 * Проверяется восемь вещей — от «мы точно не суперпользователь» до «RLS
 * отвергает запись в чужого тенанта».
 *
 * Запуск (Git Bash), ПОСЛЕ scripts/app-role-grants.sql и установки пароля:
 *
 *   DATABASE_PROVIDER=postgres \
 *   DATABASE_URL='postgresql://pilingtrack_app:ПАРОЛЬ@localhost:5435/pilingtrack_roledrill?schema=public' \
 *   npx tsx scripts/app-role-smoke.ts
 *
 * Ничего не меняет: единственная запись делается внутри транзакции, которая
 * заведомо откатывается.
 */

import 'dotenv/config';
import { db } from '../src/lib/db';
import { withReadinessTenantTransaction } from '../src/modules/readiness/infrastructure/tenant-transaction';

const TENANT = process.env.SMOKE_TENANT_ID || process.env.DEFAULT_TENANT_ID || 'orion';

let failures = 0;

function report(ok: boolean, name: string, detail: string) {
  if (!ok) failures += 1;
  console.log(`${ok ? '✅' : '❌'} ${name} — ${detail}`);
}

/** Откатываем пробную запись, не оставляя следов: своя ошибка-маркер. */
class Rollback extends Error {}

async function main() {
  console.log(`\nПроверка роли приложения. Тенант: ${TENANT}\n`);

  // 1. Кто мы на самом деле. Если тут суперпользователь — дальше можно не
  //    смотреть: RLS его не касается, и все «зелёные» проверки ниже соврут.
  const who = await db.$queryRaw<Array<{ role: string; super: boolean; bypass: boolean }>>`
    SELECT current_user AS role, rolsuper AS super, rolbypassrls AS bypass
    FROM pg_roles WHERE rolname = current_user
  `;
  const identity = who[0];
  report(
    identity?.role === 'pilingtrack_app' && !identity.super && !identity.bypass,
    'роль соединения',
    `${identity?.role} (super=${identity?.super}, bypassrls=${identity?.bypass})`
  );

  // 2. Обычная таблица в режиме аудита — читается как и раньше, без GUC.
  const reports = await db.report.count();
  report(reports > 0, 'чтение Report (режим аудита)', `${reports} строк`);

  // 3. Fail-closed таблица без тенанта — должна быть пуста. Это и есть смысл
  //    миграции 20260813030000: незаданный тенант = отказ, а не «показать всё».
  const shiftsNoTenant = await db.shift.count();
  report(shiftsNoTenant === 0, 'Shift без тенанта', `${shiftsNoTenant} строк (ожидали 0)`);

  // 4. Через обёртку — строки появляются.
  const shiftsWithTenant = await withReadinessTenantTransaction(TENANT, (tx) => tx.shift.count());
  report(shiftsWithTenant > 0, 'Shift через обёртку', `${shiftsWithTenant} строк`);

  // 5. Запись в свой тенант проходит (у политики FOR ALL выражение USING
  //    работает и как WITH CHECK — то есть UPDATE проверяется дважды).
  //    Пишем no-op и откатываем.
  let writeOk = false;
  try {
    await withReadinessTenantTransaction(TENANT, async (tx) => {
      const target = await tx.shift.findFirst({ select: { id: true } });
      if (!target) throw new Error('в копии нет ни одной смены — проверку записи провести не на чем');
      await tx.$executeRaw`UPDATE "Shift" SET "version" = "version" WHERE id = ${target.id}`;
      writeOk = true;
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) {
      report(false, 'запись в свой тенант', String((error as Error).message));
    }
  }
  if (writeOk) report(true, 'запись в свой тенант', 'UPDATE прошёл, транзакция откачена');

  // 6. Попытка увести строку в чужой тенант — RLS обязана отказать.
  let deniedCrossTenant = false;
  try {
    await withReadinessTenantTransaction(TENANT, async (tx) => {
      const target = await tx.shift.findFirst({ select: { id: true } });
      if (!target) throw new Rollback();
      await tx.$executeRaw`UPDATE "Shift" SET "tenantId" = 'somebody-else' WHERE id = ${target.id}`;
      throw new Rollback();
    });
  } catch (error) {
    const text = error instanceof Error ? `${error.message}` : String(error);
    deniedCrossTenant = /row-level security|нарушает политику/i.test(text);
    if (!deniedCrossTenant && !(error instanceof Rollback)) {
      report(false, 'запись в чужой тенант', `отказ не распознан: ${text.slice(0, 160)}`);
    }
  }
  if (deniedCrossTenant) report(true, 'запись в чужой тенант', 'отклонена политикой RLS');
  else if (!deniedCrossTenant) report(false, 'запись в чужой тенант', 'прошла или откатилась без ошибки RLS — политика не сработала');

  // 7. DDL приложению не положен: CREATE на схему public не выдавали.
  let ddlDenied = false;
  try {
    await db.$executeRawUnsafe('CREATE TABLE "app_role_smoke_probe" (id int)');
    await db.$executeRawUnsafe('DROP TABLE "app_role_smoke_probe"');
  } catch {
    ddlDenied = true;
  }
  report(ddlDenied, 'DDL запрещён', ddlDenied ? 'CREATE TABLE отклонён' : 'таблица создалась — у роли лишние права');

  // 8. Журнал миграций недоступен на запись.
  let migrationsProtected = false;
  try {
    await db.$executeRawUnsafe('DELETE FROM "_prisma_migrations" WHERE false');
  } catch {
    migrationsProtected = true;
  }
  report(migrationsProtected, '_prisma_migrations защищён', migrationsProtected ? 'запись отклонена' : 'запись разрешена — лишний грант');

  console.log(
    failures === 0
      ? '\nВсё сошлось. Роль пригодна для переключения приложения.\n'
      : `\nПровалено проверок: ${failures}. Переключать прод нельзя.\n`
  );
  await db.$disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error('\n❌ Проверка оборвалась:', error);
  await db.$disconnect().catch(() => {});
  process.exit(1);
});
