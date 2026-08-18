import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import * as path from 'node:path';
import { applyTenantGuc } from '@/core/security/tenant-rls';
import { runWithTenantContext, setRequestTenantId } from '@/core/security/tenant-context';

/**
 * Действительно ли RLS отделяет тенантов — проверка на живой базе.
 *
 * Почему нельзя проверить обычным подключением: и локально (`postgres`), и на
 * проде (`piling`) приложение ходит ролью-суперпользователем, а суперпользователь
 * обходит RLS ВСЕГДА — `FORCE ROW LEVEL SECURITY` на него не распространяется.
 * Под такой ролью тест «чужой тенант не видит строк» проходил бы, ничего не
 * проверяя. Поэтому здесь заводится отдельное подключение ролью
 * `pilingtrack_app` — не владелец, без BYPASSRLS (scripts/app-role-grants.sql).
 *
 * Тест проверяет всю цепочку целиком: контекст запроса (шаг 1) -> расширение,
 * доставляющее тенанта в `app.current_tenant` (шаг 2) -> политики RLS в базе.
 *
 * Если роли или базы нет, набор пропускается: это единственный тест в проекте,
 * которому нужна настоящая база, и он не должен ронять прогон на машине, где
 * она не поднята. Как завести роль — docs/runbooks/011-app-db-role.md.
 */
const APP_ROLE_URL = process.env.DATABASE_URL_APP_ROLE
  ?? 'postgresql://pilingtrack_app:localtest@localhost:5435/pilingtrack_test?schema=public';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;
let available = false;

beforeAll(async () => {
  try {
    const clientPath = path.join(process.cwd(), 'src', 'generated', 'postgres-client', 'client.js');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaClient } = require(clientPath);
    const raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: APP_ROLE_URL }) });
    await raw.$queryRaw`SELECT 1`;
    db = applyTenantGuc(raw);
    // Набору нужны строки тенанта orion: без них «свой тенант видит объекты»
    // упало бы не из-за поломки RLS, а из-за пустой базы.
    const [{ count }] = await raw.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) FROM "Site" WHERE "tenantId" = 'orion'
    `;
    available = Number(count) > 0;
  } catch {
    available = false;
  }
});

afterAll(async () => {
  await db?.$disconnect?.();
});

describe('RLS отделяет тенантов по-настоящему', () => {
  it('подключение непривилегированной ролью действительно без обхода RLS', async () => {
    if (!available) return expect(available).toBe(false);

    const [role] = await db.$queryRaw<Array<{ rolsuper: boolean; rolbypassrls: boolean }>>`
      SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user
    `;
    // Если это упало — тест ниже ничего не доказывает, и знать об этом надо сразу.
    expect(role.rolsuper).toBe(false);
    expect(role.rolbypassrls).toBe(false);
  });

  it('под своим тенантом объекты видны', async () => {
    if (!available) return;

    const sites = await runWithTenantContext(async () => {
      setRequestTenantId('orion');
      return db.site.findMany({ select: { id: true, tenantId: true } });
    });

    expect(sites.length).toBeGreaterThan(0);
    expect(sites.every((s: { tenantId: string | null }) => s.tenantId === 'orion')).toBe(true);
  });

  /**
   * Главная проверка: чужой тенант не видит ничего. Именно она сломается,
   * если расширение перестанет доставлять тенанта, если политику ослабят
   * оговоркой `tenantId IS NULL`, или если приложение вернут на суперроль.
   */
  it('под чужим тенантом не видно ни одной строки', async () => {
    if (!available) return;

    const sites = await runWithTenantContext(async () => {
      setRequestTenantId('чужой-тенант');
      return db.site.findMany({ select: { id: true } });
    });

    expect(sites).toEqual([]);
  });

  it('разделение держится и внутри транзакции', async () => {
    if (!available) return;

    const own = await runWithTenantContext(async () => {
      setRequestTenantId('orion');
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

  /**
   * Текущее поведение без контекста — режим аудита: политика пропускает всё,
   * когда `app.current_tenant` не выставлен. Это ЗАФИКСИРОВАНО намеренно, а не
   * одобрено: шаг 6 плана убирает эту оговорку, и тогда ожидание здесь
   * поменяется на пустой список. Пока же тест стережёт обратное — что
   * включение механизма не сломало пути, где тенанта нет (воркеры, миграции).
   */
  it('без тенанта пока действует режим аудита — строки видны', async () => {
    if (!available) return;

    const sites = await db.site.findMany({ select: { id: true } });
    expect(sites.length).toBeGreaterThan(0);
  });
});
