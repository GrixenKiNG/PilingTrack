// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@/generated/postgres-client/client';
import { applyTenantGuc, wrapTransaction } from '@/core/security/tenant-rls';
import { createFixture } from '../../../../../tests/integration/helpers/disposable-db';

const state = vi.hoisted(() => ({ db: undefined as PrismaClient | undefined }));
vi.mock('@/lib/db', () => ({ get db() { return state.db; } }));

describe.skipIf(!process.env.INTEGRATION_DATABASE_URL_OWNER)('outbox failures on exclusive migrated PostgreSQL', () => {
  let container: string;
  let fixture: Awaited<ReturnType<typeof createFixture>>;
  let raw: PrismaClient;
  let publish: typeof import('../outbox-publisher').publishOutboxEvents;
  let project: typeof import('../outbox-publisher').projectOutboxEvents;
  let tenant: string;
  const runWorker = (mode: string, aggregateId: string) => spawnSync(process.execPath, [
    '--import', 'tsx', 'src/modules/reports/application/__tests__/outbox-process.fixture.ts',
  ], { env: { ...process.env, NIGHT_OUTBOX_MODE: mode, NIGHT_OUTBOX_AGGREGATE_ID: aggregateId, NIGHT_OUTBOX_TENANT_ID: tenant }, windowsHide: true, encoding: 'utf8', timeout: 30_000 });

  beforeAll(async () => {
    // Never use the caller's DB: the normal application/worker may be live.
    // Existing helper owns its container and keeps credentials in stdout/RAM.
    const output = execFileSync('C:/Program Files/Git/bin/bash.exe', ['scripts/test-db-up.sh'], { encoding: 'utf8', windowsHide: true, timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] });
    const values = Object.fromEntries(output.trim().split(/\r?\n/).map(line => {
      const match = /^export ([A-Z_]+)=(.*)$/.exec(line);
      if (!match) throw new Error('Unexpected disposable helper output');
      return [match[1], match[2]];
    }));
    container = values.INTEGRATION_DB_CONTAINER;
    if (!/^codex-pg-[a-f0-9]{12}$/.test(container)) throw new Error('Invalid owned container');
    for (const key of ['INTEGRATION_DB_CONTAINER', 'INTEGRATION_DATABASE_URL_OWNER', 'INTEGRATION_DATABASE_URL_APP']) vi.stubEnv(key, values[key]);
    vi.stubEnv('DATABASE_URL', values.INTEGRATION_DATABASE_URL_APP);
    vi.stubEnv('DATABASE_URL_POSTGRES', values.INTEGRATION_DATABASE_URL_APP);
    fixture = await createFixture();
    const role = await fixture.app.query('SELECT current_user AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user');
    expect(role.rows).toEqual([{ name: 'pilingtrack_app', rolsuper: false, rolbypassrls: false }]);
    tenant = fixture.tenants[0];
    raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: values.INTEGRATION_DATABASE_URL_APP, max: 2 }) });
    // Same Prisma/RLS adapter boundary as lib/db; the wrapper preserves its API.
    const scoped = applyTenantGuc(raw as unknown as Parameters<typeof applyTenantGuc>[0]) as unknown as PrismaClient;
    state.db = new Proxy(scoped, { get(client, key) {
      if (key === '$transaction') return (...args: unknown[]) => wrapTransaction(
        client as unknown as Parameters<typeof wrapTransaction>[0],
        client.$transaction as unknown as (...callArgs: unknown[]) => Promise<unknown>,
        args,
      );
      return Reflect.get(client, key);
    } });
    ({ publishOutboxEvents: publish, projectOutboxEvents: project } = await import('../outbox-publisher'));
  }, 150_000);

  beforeEach(async () => {
    await fixture.owner.query('DELETE FROM "DeadLetterQueue"');
    await fixture.owner.query('DELETE FROM "OutboxEvent"');
    await fixture.owner.query('DELETE FROM "AuditLog" WHERE action=$1', ['night.outbox.marker']);
  });
  afterAll(async () => {
    if (raw) await raw.$disconnect();
    if (fixture) await fixture.close();
    if (container) execFileSync('C:/Program Files/Git/bin/bash.exe', ['scripts/test-db-down.sh', container], { windowsHide: true, stdio: 'pipe' });
    vi.unstubAllEnvs();
  });
  const seed = async (tenantId: string | null = tenant) => {
    const id = randomUUID();
    await fixture.owner.query('INSERT INTO "OutboxEvent" (id,type,"aggregateId","aggregateType",payload,"tenantId") VALUES ($1,$2,$3,$4,$5,$6)', [id, 'NightOutboxFault', id, 'Report', '{}', tenantId]);
    return id;
  };
  const row = async (id: string) => (await fixture.owner.query('SELECT * FROM "OutboxEvent" WHERE id=$1', [id])).rows[0];
  const expireBackoff = (id: string) => fixture.owner.query('UPDATE "OutboxEvent" SET "nextRetryAt"=$2 WHERE id=$1', [id, new Date(0)]);

  for (const failed of ['published', 'projected'] as const) {
    it(`${failed} failures postpone the healthy consumer; DLQ preserves both outcomes`, async () => {
      const id = await seed();
      const fail = failed === 'published' ? publish : project;
      const healthy = failed === 'published' ? project : publish;
      let healthyCalls = 0;
      for (let attempt = 1; attempt <= 5; attempt++) {
        if (attempt > 1) await expireBackoff(id);
        await fail(async () => { throw new Error('Injected ' + failed + ' failure'); });
        expect((await row(id)).attempts).toBe(attempt);
        if (attempt === 1) {
          expect(await healthy(async () => { healthyCalls++; })).toBe(0);
          expect(healthyCalls).toBe(0);
        }
      }
      const dlq = await fixture.owner.query('SELECT consumer,"sourceOutboxId",attempts FROM "DeadLetterQueue" WHERE "sourceOutboxId"=$1', [id]);
      expect(dlq.rows).toEqual([{ consumer: failed, sourceOutboxId: id, attempts: 5 }]);
      await expireBackoff(id);
      expect(await healthy(async () => { healthyCalls++; })).toBe(1);
      expect(healthyCalls).toBe(1);
      expect(await row(id)).toMatchObject({ published: true, projected: true });
    });
  }

  it('survives an actual process crash between side effect and claim without duplicating an idempotent effect', async () => {
    const id = await seed();
    const failed = runWorker('fail', id);
    expect(failed.status, failed.stderr).toBe(0);
    expect(await row(id)).toMatchObject({ attempts: 1, published: false });
    await expireBackoff(id);
    const crashed = runWorker('crash', id);
    expect(crashed.status, crashed.stderr).toBe(23);
    expect((await row(id)).published).toBe(false);
    const restarted = runWorker('ok', id);
    expect(restarted.status, restarted.stderr).toBe(0);
    expect((await row(id)).published).toBe(true);
    const markers = await fixture.owner.query('SELECT count(*)::int AS count FROM "AuditLog" WHERE id=$1', [id + '-restart-marker']);
    expect(markers.rows[0].count).toBe(1);
  }, 90_000);

  it('polling an already processed row does not call its handler again', async () => {
    const id = await seed();
    let calls = 0;
    const handler = async () => { calls++; };
    expect(await publish(handler)).toBe(1);
    const first = await row(id);
    expect(await publish(handler)).toBe(0);
    expect(calls).toBe(1);
    expect(await row(id)).toEqual(first);
  });

  it('fails closed before invoking a handler for an event without tenantId', async () => {
    const id = await seed(null);
    let calls = 0;
    await publish(async () => { calls++; });
    expect(calls).toBe(0);
    expect((await row(id)).published).toBe(false);
    await expireBackoff(id);
    await project(async () => { calls++; });
    expect(calls).toBe(0);
    expect((await row(id)).projected).toBe(false);
  });
});
