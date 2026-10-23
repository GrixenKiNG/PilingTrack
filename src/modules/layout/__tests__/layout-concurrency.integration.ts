import {afterAll, beforeAll, expect, it} from 'vitest';
import pg from 'pg';
import {getLayout, getLayoutSnapshot, saveLayoutSnapshot, deleteLayout, saveLayout} from '../application/layout-service';
import {DEFAULT_EQUIPMENT_TILE_TEMPLATE} from '../domain/equipment-tile-template';
import {MONITORING_EQUIPMENT_TILE_SURFACE_ID as surfaceId} from '../domain/surfaces';
import {runWithTenantContext, setRequestTenantId} from '@/core/security/tenant-context';
import {db} from '@/lib/db';

const tenantId = 'synthetic-layout-concurrency';
const ownerUrl = new URL(process.env.INTEGRATION_DATABASE_URL_OWNER ?? 'http://invalid');
if (ownerUrl.hostname !== '127.0.0.1' || ownerUrl.pathname !== '/codex_test') throw Error('Own disposable PostgreSQL required');
const owner = new pg.Client({connectionString: ownerUrl.toString()});
const template = structuredClone(DEFAULT_EQUIPMENT_TILE_TEMPLATE);
const at = new Date('2026-01-01T00:00:00.000Z');
const revision = `"synthetic-layout-row:${at.toISOString()}"`;
function scoped<T>(fn: () => T): T {
  return runWithTenantContext(() => {setRequestTenantId(tenantId); return fn();});
}
beforeAll(async () => {
  await owner.connect();
  await owner.query('INSERT INTO "Tenant" (id,slug,name,"updatedAt") VALUES ($1,$1,$1,now())', [tenantId]);
  await owner.query('INSERT INTO "ModuleLayoutTemplate" (id,"tenantId","surfaceId","entityId",template,"updatedBy","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7)',
    ['synthetic-layout-row', tenantId, surfaceId, '', JSON.stringify(template), 'synthetic-admin', at]);
});
afterAll(async () => {await db.$disconnect(); await owner.end();});

it('two tabs reading the same old JSON cannot both save their distinct drafts', async () => {
  const [first, second] = await Promise.all([scoped(() => getLayout(tenantId, surfaceId)), scoped(() => getLayout(tenantId, surfaceId))]);
  expect(first).toEqual(template); expect(second).toEqual(template);
  const drafts = [structuredClone(template), structuredClone(template)];
  drafts[0].card.gap = 3; drafts[1].card.gap = 7;
  const results = await Promise.allSettled(drafts.map(draft => scoped(() => saveLayout(tenantId, surfaceId, draft, 'synthetic-admin', '', revision))));
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  const rejected = results.find(r => r.status === 'rejected');
  expect(rejected?.status === 'rejected' && rejected.reason.status).toBe(409);
  const winner = results.findIndex(r => r.status === 'fulfilled');
  expect(await scoped(() => getLayout(tenantId, surfaceId))).toEqual(drafts[winner]);
});

it('a legacy save without a revision fails closed', async () => {
  await expect(scoped(() => saveLayout(tenantId, surfaceId, template, 'synthetic-admin'))).rejects.toMatchObject({status: 409});
});

it('concurrent first saves cannot both create an override; stale resets cannot remove the winner', async () => {
  const entityId = 'synthetic-new-rig';
  const initial = await scoped(() => getLayoutSnapshot(tenantId, surfaceId, entityId));
  expect(initial.revision).toBe('"none"');
  const drafts = [structuredClone(template), structuredClone(template)];
  drafts[0].card.gap = 4; drafts[1].card.gap = 9;
  const results = await Promise.allSettled(drafts.map(draft => scoped(() => saveLayoutSnapshot(tenantId, surfaceId, draft, 'synthetic-admin', entityId, initial.revision))));
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  const loser = results.find(r => r.status === 'rejected');
  expect(loser?.status === 'rejected' && loser.reason.status).toBe(409);
  const current = await scoped(() => getLayoutSnapshot(tenantId, surfaceId, entityId));
  await expect(scoped(() => deleteLayout(tenantId, surfaceId, entityId, initial.revision))).rejects.toMatchObject({status: 409});
  expect(await scoped(() => getLayoutSnapshot(tenantId, surfaceId, entityId))).toEqual(current);
  await scoped(() => deleteLayout(tenantId, surfaceId, entityId, current.revision));
  expect((await scoped(() => getLayoutSnapshot(tenantId, surfaceId, entityId))).revision).toBe('"none"');
});

it('successive saves advance the revision and return a token matching their own JSON', async () => {
  const initial = await scoped(() => getLayoutSnapshot(tenantId, surfaceId));
  const draft = structuredClone(template); draft.card.gap = 6;
  const saved = await scoped(() => saveLayoutSnapshot(tenantId, surfaceId, draft, 'synthetic-admin', '', initial.revision));
  expect(saved.revision).not.toBe(initial.revision);
  expect(await scoped(() => getLayoutSnapshot(tenantId, surfaceId))).toEqual(saved);
  await expect(scoped(() => saveLayout(tenantId, surfaceId, template, 'synthetic-admin', '', initial.revision))).rejects.toMatchObject({status: 409});
});
