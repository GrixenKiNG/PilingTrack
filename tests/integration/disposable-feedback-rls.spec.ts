import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFixture, inTenant } from './helpers/disposable-db';

const enabled = Boolean(process.env.INTEGRATION_DATABASE_URL_OWNER && process.env.INTEGRATION_DATABASE_URL_APP);
describe.skipIf(!enabled)('Feedback read state belongs to its recipient tenant', () => {
  let fixture: Awaited<ReturnType<typeof createFixture>>;
  let eventId: string;
  const readId = (tenant: string) => tenant + '-feedback-read';
  beforeAll(async () => {
    fixture = await createFixture();
    eventId = fixture.tenants[0] + '-global-event';
    await fixture.owner.query('INSERT INTO "FeedbackEvent" (id,scope,action,title,message,audience) VALUES ($1,$2,$3,$4,$5,$6)', [eventId, 'codex', 'codex.rls', 'Codex', 'Global event', 'ALL']);
    for (const tenant of fixture.tenants) {
      await fixture.owner.query('INSERT INTO "FeedbackEventRead" (id,"eventId","userId","updatedAt") VALUES ($1,$2,$3,now())', [readId(tenant), eventId, fixture.id(tenant, 'User')]);
    }
  });
  afterAll(async () => {
    if (!fixture) return;
    try { await fixture.owner.query('DELETE FROM "FeedbackEvent" WHERE id=$1', [eventId]); }
    finally { await fixture.close(); }
  });

  it('uses the actual non-bypass application role', async () => {
    expect((await fixture.app.query('SELECT current_user')).rows[0].current_user).toBe('pilingtrack_app');
    expect((await fixture.app.query("SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0]).toEqual({rolsuper: false, rolbypassrls: false});
  });
  it('both tenants still see the ALL event, and only their own read state', async () => {
    for (const tenant of fixture.tenants) await inTenant(fixture.app, tenant, async () => {
      expect((await fixture.app.query('SELECT id FROM "FeedbackEvent" WHERE id=$1', [eventId])).rows).toEqual([{id: eventId}]);
      expect((await fixture.app.query('SELECT id FROM "FeedbackEventRead" WHERE "eventId"=$1', [eventId])).rows).toEqual([{id: readId(tenant)}]);
    });
  });
  it('missing and empty tenant hide all read states', async () => {
    expect((await fixture.app.query('SELECT id FROM "FeedbackEventRead" WHERE "eventId"=$1', [eventId])).rows).toEqual([]);
    expect((await inTenant(fixture.app, '', () => fixture.app.query('SELECT id FROM "FeedbackEventRead" WHERE "eventId"=$1', [eventId]))).rows).toEqual([]);
  });
  it('foreign read state cannot be updated or deleted', async () => {
    await inTenant(fixture.app, fixture.tenants[0], async () => {
      expect((await fixture.app.query('UPDATE "FeedbackEventRead" SET "readAt"=now() WHERE id=$1', [readId(fixture.tenants[1])])).rowCount).toBe(0);
      expect((await fixture.app.query('DELETE FROM "FeedbackEventRead" WHERE id=$1', [readId(fixture.tenants[1])])).rowCount).toBe(0);
    });
  });
  it('own recipient can insert and acknowledge read state', async () => {
    const tenant = fixture.tenants[0];
    await inTenant(fixture.app, tenant, async () => {
      await fixture.app.query('DELETE FROM "FeedbackEventRead" WHERE id=$1', [readId(tenant)]);
      expect((await fixture.app.query('INSERT INTO "FeedbackEventRead" (id,"eventId","userId","updatedAt") VALUES ($1,$2,$3,now())', [readId(tenant), eventId, fixture.id(tenant, 'User')])).rowCount).toBe(1);
      expect((await fixture.app.query('UPDATE "FeedbackEventRead" SET "readAt"=now(),"acknowledgedAt"=now() WHERE id=$1', [readId(tenant)])).rowCount).toBe(1);
    });
  });
  it('foreign recipient insert fails even for an existing global event', async () => {
    await expect(inTenant(fixture.app, fixture.tenants[0], async () => {
      await fixture.app.query('DELETE FROM "FeedbackEventRead" WHERE id=$1', [readId(fixture.tenants[1])]);
      await fixture.app.query('INSERT INTO "FeedbackEventRead" (id,"eventId","userId","updatedAt") VALUES ($1,$2,$3,now())', [readId(fixture.tenants[1]), eventId, fixture.id(fixture.tenants[1], 'User')]);
    })).rejects.toMatchObject({code: '42501'});
  });
  it('missing tenant rejects insertion', async () => {
    await fixture.app.query('BEGIN');
    try {
      await fixture.owner.query('DELETE FROM "FeedbackEventRead" WHERE id=$1', [readId(fixture.tenants[0])]);
      await expect(fixture.app.query('INSERT INTO "FeedbackEventRead" (id,"eventId","userId","updatedAt") VALUES ($1,$2,$3,now())', [readId(fixture.tenants[0]), eventId, fixture.id(fixture.tenants[0], 'User')])).rejects.toMatchObject({code: '42501'});
    } finally { await fixture.app.query('ROLLBACK'); }
  });
});
