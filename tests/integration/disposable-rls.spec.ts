import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFixture, inTenant, tables } from './helpers/disposable-db';

const enabled = Boolean(process.env.INTEGRATION_DATABASE_URL_OWNER && process.env.INTEGRATION_DATABASE_URL_APP);
if (!enabled) console.info('SKIP disposable RLS: set INTEGRATION_DATABASE_URL_OWNER and INTEGRATION_DATABASE_URL_APP from scripts/test-db-up.sh');

describe.skipIf(!enabled)('RLS on all deployed migrations, real application role', () => {
  let fixture: Awaited<ReturnType<typeof createFixture>>;
  beforeAll(async () => { fixture = await createFixture(); });
  afterAll(async () => { await fixture?.close(); });

  it('uses the exact application and identity roles with production privileges', async () => {
    const roles = await fixture.app.query("SELECT rolname, rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname IN ('pilingtrack_app','pilingtrack_identity') ORDER BY rolname");
    expect(roles.rows).toEqual([
      { rolname: 'pilingtrack_app', rolsuper: false, rolbypassrls: false, rolcanlogin: true },
      { rolname: 'pilingtrack_identity', rolsuper: false, rolbypassrls: true, rolcanlogin: false },
    ]);
    expect((await fixture.app.query('SELECT current_user')).rows[0].current_user).toBe('pilingtrack_app');
  });

  for (const table of tables) {
    it(`${table}: two tenants see only their own seeded row`, async () => {
      for (const tenant of fixture.tenants) {
        const rows = await inTenant(fixture.app, tenant, () => fixture.app.query(`SELECT id, "tenantId" FROM "${table}" ORDER BY id`));
        expect(rows.rows).toEqual([{ id: fixture.id(tenant, table), tenantId: tenant }]);
      }
    });
    it(`${table}: missing and empty tenant fail closed`, async () => {
      expect((await fixture.app.query(`SELECT id FROM "${table}"`)).rows).toEqual([]);
      expect((await inTenant(fixture.app, '', () => fixture.app.query(`SELECT id FROM "${table}"`))).rows).toEqual([]);
    });
    it(`${table}: rejects a write to the other tenant with RLS error 42501`, async () => {
      await expect(inTenant(fixture.app, fixture.tenants[0], () => fixture.insert(table, fixture.tenants[1], '-forbidden'))).rejects.toMatchObject({ code: '42501' });
    });
  }

  it('does not leak local tenant between transactions on the same backend (transaction-pool contract)', async () => {
    const backend = (await fixture.app.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    for (const tenant of fixture.tenants) {
      await fixture.app.query('BEGIN');
      try {
        await fixture.app.query("SELECT set_config('app.current_tenant', $1, true)", [tenant]);
        expect((await fixture.app.query('SELECT id FROM "Site"')).rows).toEqual([{ id: fixture.id(tenant, 'Site') }]);
        await fixture.app.query('COMMIT');
      } catch (error) { await fixture.app.query('ROLLBACK'); throw error; }
      expect((await fixture.app.query('SELECT pg_backend_pid() AS pid')).rows[0].pid).toBe(backend);
      for (const table of tables) expect((await fixture.app.query(`SELECT id FROM "${table}"`)).rows).toEqual([]);
    }
  });

  it('app cannot read the migration journal or create schema objects', async () => {
    await expect(fixture.app.query('SELECT * FROM "_prisma_migrations"')).rejects.toMatchObject({ code: '42501' });
    await expect(fixture.app.query('CREATE TABLE codex_forbidden (id text)')).rejects.toMatchObject({ code: '42501' });
  });
});
