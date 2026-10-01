import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/postgres-client/client';
import { applyTenantGuc, wrapTransaction } from '../../src/core/security/tenant-rls';
import { runWithTenantContext, setRequestTenantId } from '../../src/core/security/tenant-context';
import { createFixture } from './helpers/disposable-db';

const state = vi.hoisted(() => ({ db: undefined as PrismaClient | undefined }));
vi.mock('@/lib/db', () => ({ get db() { return state.db; }, DEFAULT_TX_OPTIONS: { timeout: 10_000, maxWait: 5_000 } }));
// Keep the real command and SQL; avoid booting unrelated equipment/worker services.
vi.mock('@/modules/equipment', async () => ({ recordMeterReadingInTx: (await import('../../src/modules/equipment/application/commands/meter-reading')).recordMeterReadingInTx }));
vi.mock('@/modules/readiness/server', async () => ({ requestReadinessSnapshot: (await import('../../src/modules/readiness/application/projection/request-snapshot')).requestReadinessSnapshot }));

const enabled = Boolean(process.env.INTEGRATION_DATABASE_URL_OWNER && process.env.INTEGRATION_DATABASE_URL_APP);
if (!enabled) console.info('SKIP real readiness pipeline: supply both INTEGRATION_DATABASE_URL_* from scripts/test-db-up.sh');

describe.skipIf(!enabled)('Tech Readiness real source → outbox → snapshot → read model', () => {
  let fixture: Awaited<ReturnType<typeof createFixture>>;
  let raw: PrismaClient;
  let complete: typeof import('../../src/modules/inspections/application/commands/inspection-commands').completeInspectionWithOutcome;
  let project: typeof import('../../src/modules/readiness/application/projection/project-event').projectReadinessEvent;
  beforeAll(async () => {
    raw = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.INTEGRATION_DATABASE_URL_APP!, max: 1 }) });
    const scoped = applyTenantGuc(raw);
    state.db = new Proxy(scoped, {
      get(client, key) {
        if (key === '$transaction') return (...args: unknown[]) => wrapTransaction(client, client.$transaction as never, args);
        return Reflect.get(client, key);
      },
    });
    complete = (await import('../../src/modules/inspections/application/commands/inspection-commands')).completeInspectionWithOutcome;
    project = (await import('../../src/modules/readiness/application/projection/project-event')).projectReadinessEvent;
  });
  beforeEach(async () => { fixture = await createFixture(); });
  afterAll(async () => { await raw?.$disconnect(); });
  afterEach(async () => {
    if (fixture) {
      for (const tenant of fixture.tenants) {
        await fixture.owner.query('DELETE FROM "CurrentReadiness" WHERE "tenantId" = $1', [tenant]);
        await fixture.owner.query('DELETE FROM "OutboxEvent" WHERE "tenantId" = $1', [tenant]);
      }
      // Immutable snapshots deliberately remain until this disposable container is removed.
      await fixture.close();
    }
  });
  const tenant = () => fixture.tenants[0];
  const inspectionId = () => fixture.id(tenant(), 'Inspection');
  const scoped = <T>(work: () => Promise<T>) => runWithTenantContext(async () => { setRequestTenantId(tenant()); return work(); });
  const finish = () => scoped(() => complete(inspectionId(), { tenantId: tenant(), signedByName: 'Disposable operator' }));
  const events = () => fixture.owner.query('SELECT id, projected, payload FROM "OutboxEvent" WHERE "aggregateId" = $1 ORDER BY id', [inspectionId()]);

  it('rolls back the source when the real database rejects the outbox insert', async () => {
    await fixture.owner.query(`CREATE FUNCTION codex_reject_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."tenantId" = '${tenant()}' THEN RAISE EXCEPTION 'codex injected outbox failure'; END IF; RETURN NEW; END $$`);
    await fixture.owner.query('CREATE TRIGGER codex_reject_outbox BEFORE INSERT ON "OutboxEvent" FOR EACH ROW EXECUTE FUNCTION codex_reject_outbox()');
    try {
      await expect(finish()).rejects.toThrow(/codex injected outbox failure/);
      expect((await fixture.owner.query('SELECT status FROM "Inspection" WHERE id = $1', [inspectionId()])).rows).toEqual([{ status: 'DRAFT' }]);
      expect((await events()).rows).toEqual([]);
    } finally {
      await fixture.owner.query('DROP TRIGGER codex_reject_outbox ON "OutboxEvent"');
      await fixture.owner.query('DROP FUNCTION codex_reject_outbox()');
    }
  });
  it('commits completion and exactly one outbox event, replaying without another event', async () => {
    expect((await finish()).replayed).toBe(false);
    expect((await finish()).replayed).toBe(true);
    const rows = (await events()).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ projected: false, payload: { triggerType: 'INSPECTION_COMPLETED', inspectionId: inspectionId() } });
    expect((await fixture.owner.query('SELECT status FROM "Inspection" WHERE id = $1', [inspectionId()])).rows).toEqual([{ status: 'COMPLETED' }]);
  });
  it('rejects another tenant and leaves its source unchanged', async () => {
    const other = fixture.tenants[1];
    await expect(scoped(() => complete(fixture.id(other, 'Inspection'), { tenantId: tenant(), signedByName: 'Disposable operator' }))).rejects.toThrow('Inspection not found');
    expect((await fixture.owner.query('SELECT status FROM "Inspection" WHERE id = $1', [fixture.id(other, 'Inspection')])).rows).toEqual([{ status: 'DRAFT' }]);
  });
  it('does not commit a snapshot or projected marker when the database rejects the read model', async () => {
    await finish();
    const event = (await events()).rows[0];
    await fixture.owner.query(`CREATE FUNCTION codex_reject_current() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."tenantId" = '${tenant()}' THEN RAISE EXCEPTION 'codex injected projection failure'; END IF; RETURN NEW; END $$`);
    await fixture.owner.query('CREATE TRIGGER codex_reject_current BEFORE INSERT ON "CurrentReadiness" FOR EACH ROW EXECUTE FUNCTION codex_reject_current()');
    try {
      await expect(project(event.id)).rejects.toThrow(/codex injected projection failure/);
      expect((await events()).rows[0].projected).toBe(false);
      expect((await fixture.owner.query('SELECT id FROM "ReadinessScoreSnapshot" WHERE "tenantId" = $1', [tenant()])).rows).toEqual([]);
    } finally {
      await fixture.owner.query('DROP TRIGGER codex_reject_current ON "CurrentReadiness"');
      await fixture.owner.query('DROP FUNCTION codex_reject_current()');
    }
  });
  it('projects the real event once and persists the immutable snapshot and current model', async () => {
    await finish();
    const event = (await events()).rows[0];
    expect(await project(event.id)).toMatchObject({ projected: true, duplicate: false });
    expect(await project(event.id)).toEqual({ projected: false, duplicate: true });
    expect((await events()).rows[0].projected).toBe(true);
    const snapshots = await fixture.owner.query('SELECT id, "triggerType", "factsHash", facts FROM "ReadinessScoreSnapshot" WHERE "tenantId" = $1', [tenant()]);
    expect(snapshots.rows).toHaveLength(1);
    await expect(fixture.owner.query('UPDATE "ReadinessScoreSnapshot" SET score = 0 WHERE id = $1', [snapshots.rows[0].id])).rejects.toThrow('ReadinessScoreSnapshot is immutable');
    expect(snapshots.rows[0]).toMatchObject({ triggerType: 'INSPECTION_COMPLETED', factsHash: expect.any(Buffer), facts: expect.any(Object) });
    expect((await fixture.owner.query('SELECT "snapshotId" FROM "CurrentReadiness" WHERE "tenantId" = $1', [tenant()])).rows).toEqual([{ snapshotId: snapshots.rows[0].id }]);
  });
});
