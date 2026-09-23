import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import * as path from 'node:path';
import { applyTenantGuc } from '@/core/security/tenant-rls';
import { runWithTenantContext, setRequestTenantId } from '@/core/security/tenant-context';

/**
 * Действительно ли RLS отделяет тенантов — проверка на живой базе.
 *
 * Почему нужно отдельное подключение: суперпользователь обходит RLS ВСЕГДА,
 * `FORCE ROW LEVEL SECURITY` на него не распространяется. Под такой ролью тест
 * «чужой тенант не видит строк» проходил бы, ничего не проверяя. Поэтому здесь
 * подключаются ролью `pilingtrack_app` — не владелец, без BYPASSRLS
 * (scripts/app-role-grants.sql).
 *
 * Где какая роль сейчас: прод переведён на `pilingtrack_app` 13.08.2026
 * (ранбук 011, проверено 22.09.2026: rolsuper=f, rolbypassrls=f), локальная
 * разработка — тоже, с 22.09.2026. Роль-владелец (`piling` на проде,
 * `postgres` локально) осталась только за миграциями и сидами.
 *
 * Тест проверяет всю цепочку целиком: контекст запроса (шаг 1) -> расширение,
 * доставляющее тенанта в `app.current_tenant` (шаг 2) -> политики RLS в базе.
 *
 * Если роли или базы нет, набор пропускается — иначе прогон падал бы на машине
 * без поднятой базы. Пропуск, однако, не должен проходить незамеченным: на CI
 * шаг «RLS isolation suite must actually run» объявляет его падением, а
 * vitest.config.ts подставляет адреса из `.env`, чтобы гейт открывался и
 * локально. До 22.09.2026 не было ни того, ни другого, и набор молчал.
 * Как завести роль — docs/runbooks/011-app-db-role.md.
 */
const APP_ROLE_URL = process.env.DATABASE_URL_APP_ROLE;
// Привилегированное подключение — только чтобы завести и убрать собственную
// строку. Тест не должен зависеть от того, что в базе уже что-то лежит:
// локально данные приезжают из прода, в CI база пустая, и «видно свои строки»
// молча превращалось бы в «строк нет вообще».
const OWNER_URL = process.env.DATABASE_URL_POSTGRES;
const OWN_TENANT = 'orion';
const FIXTURE_SITE_ID = 'rls-spec-site';
// An explicitly configured database must work; missing configuration is SKIP,
// never a successful test that ran no assertions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;

describe.skipIf(!APP_ROLE_URL)('RLS отделяет тенантов по-настоящему', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let owner: any;

  beforeAll(async () => {
    const clientPath = path.join(process.cwd(), 'src', 'generated', 'postgres-client', 'client.js');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaClient } = require(clientPath);
    const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: APP_ROLE_URL! }) });
    db = applyTenantGuc(raw);
    await raw.$queryRaw`SELECT 1`;

    // Набор гейтится на роли приложения, а владелец задаётся отдельно: если
    // его нет, сеять нечем — падаем вслух, а не тихо проверяем пустую базу.
    if (!OWNER_URL) {
      throw new Error('DATABASE_URL_POSTGRES обязателен: без владельца тест не может завести фикстуру');
    }
    owner = new PrismaClient({ adapter: new PrismaPg({ connectionString: OWNER_URL }) });
    await owner.$executeRaw`
      INSERT INTO "Tenant" ("id", "slug", "name", "updatedAt")
      VALUES (${OWN_TENANT}, ${OWN_TENANT}, 'RLS spec tenant', now())
      ON CONFLICT ("id") DO NOTHING
    `;
    await owner.$executeRaw`
      INSERT INTO "Site" ("id", "tenantId", "name", "updatedAt")
      VALUES (${FIXTURE_SITE_ID}, ${OWN_TENANT}, 'RLS spec site', now())
      ON CONFLICT ("id") DO NOTHING
    `;
  });

  afterAll(async () => {
    if (owner) {
      await owner.$executeRaw`DELETE FROM "Site" WHERE "id" = ${FIXTURE_SITE_ID}`;
      await owner.$disconnect();
    }
    await db?.$disconnect?.();
  });
  it('подключение непривилегированной ролью действительно без обхода RLS', async () => {

    const [role] = await db.$queryRaw<Array<{ rolsuper: boolean; rolbypassrls: boolean }>>`
      SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user
    `;
    // Если это упало — тест ниже ничего не доказывает, и знать об этом надо сразу.
    expect(role.rolsuper).toBe(false);
    expect(role.rolbypassrls).toBe(false);
  });

  it('под своим тенантом объекты видны', async () => {

    const sites = await runWithTenantContext(async () => {
      setRequestTenantId(OWN_TENANT);
      return db.site.findMany({ select: { id: true, tenantId: true } });
    });

    expect(sites.length).toBeGreaterThan(0);
    expect(sites.every((s: { tenantId: string | null }) => s.tenantId === OWN_TENANT)).toBe(true);
  });

  /**
   * Главная проверка: чужой тенант не видит ничего. Именно она сломается,
   * если расширение перестанет доставлять тенанта, если политику ослабят
   * оговоркой `tenantId IS NULL`, или если приложение вернут на суперроль.
   */
  it('под чужим тенантом не видно ни одной строки', async () => {

    const sites = await runWithTenantContext(async () => {
      setRequestTenantId('чужой-тенант');
      return db.site.findMany({ select: { id: true } });
    });

    expect(sites).toEqual([]);
  });

  it('разделение держится и внутри транзакции', async () => {

    const own = await runWithTenantContext(async () => {
      setRequestTenantId(OWN_TENANT);
      return db.$transaction(async (tx: { site: { findMany: () => Promise<unknown[]> } }) =>
        tx.site.findMany()
      );
    });
    expect(own.length).toBeGreaterThan(0);

    // Внутри транзакции тенант выставляется один раз, в начале, — и должен
    // действовать на все операции до конца транзакции, а не только на первую.
    const stranger = await runWithTenantContext(async () => {
      setRequestTenantId('чужой-тенант');
      return db.$transaction(async (tx: { site: { findMany: () => Promise<unknown[]> } }) => {
        await tx.site.findMany();
        return tx.site.findMany();
      });
    });
    expect(stranger).toEqual([]);
  });

  it('без тенанта данные закрыты', async () => {

    const sites = await db.site.findMany({ select: { id: true } });
    expect(sites).toEqual([]);
  });
});
