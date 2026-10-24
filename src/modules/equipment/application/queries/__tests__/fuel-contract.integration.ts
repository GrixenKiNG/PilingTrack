/** Explicit node:test runner; real app-role queries against test-db-up.sh only. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import { Pool } from 'pg';
import { db } from '@/lib/db';
import { runWithTenantContext, setRequestTenantId } from '@/core/security/tenant-context';
import { getFuelSummary } from '../equipment-query.service';
import { getEquipmentAnalytics } from '@/modules/analytics';

for (const value of [process.env.INTEGRATION_DATABASE_URL_OWNER, process.env.INTEGRATION_DATABASE_URL_APP]) {
  assert.ok(value, 'Disposable URLs required; no skips');
  const url = new URL(value);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname));
  assert.equal(url.pathname, '/codex_test');
}
assert.match(process.env.INTEGRATION_DB_CONTAINER ?? '', /^codex-pg-[a-f0-9]{12}$/);
const pool = new Pool({ connectionString: process.env.INTEGRATION_DATABASE_URL_OWNER, max: 2 });
const tenant = 'fuel-' + randomUUID();
const other = 'fuel-other-' + randomUUID();
const equipmentId = 'fuel-rig-' + randomUUID();
const from = new Date('2026-01-01T00:00:00Z');
const to = new Date('2026-01-02T00:00:00Z');
async function scoped<T>(fn: () => Promise<T>) {
  return runWithTenantContext(() => { setRequestTenantId(tenant); return fn(); });
}
async function counter(value: number, hour: number, scope = tenant, siteId: string | null = null) {
  await pool.query('INSERT INTO "TelemetryRecord" (id,"tenantId","equipmentId",type,value,timestamp,"siteId") VALUES ($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), scope, equipmentId, 'fuel_total', value, new Date(from.getTime() + hour * 3600000), siteId]);
}
let manualOrder = 0;
async function manual(percent: number | null, hour: number, added: number | null = null) {
  await pool.query('INSERT INTO "FuelLog" (id,"tenantId","equipmentId","recordedAt","tankPercent","litersAdded","createdAt") VALUES ($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), tenant, equipmentId, new Date(from.getTime() + hour * 3600000), percent, added, new Date(from.getTime() + manualOrder++)]);
}
async function results() {
  const journal = await scoped(() => getFuelSummary(equipmentId, tenant, from, new Date(to.getTime() - 1)));
  const analytics = await scoped(() => getEquipmentAnalytics({ tenantId: tenant, dateFrom: '2026-01-01', dateTo: '2026-01-01', timezone: 'UTC' }));
  assert.deepEqual(analytics.equipment[0].fuelConsumption, journal.consumption);
  assert.equal(analytics.fleet.fuelLiters, journal.consumedLiters);
  return journal.consumption;
}
before(async () => {
  for (const id of [tenant, other]) await pool.query('INSERT INTO "Tenant" (id,slug,name,"updatedAt") VALUES ($1,$1,$1,NOW())', [id]);
  await pool.query('INSERT INTO "Equipment" (id,name,"tenantId","fuelTankLiters","updatedAt") VALUES ($1,$3,$2,200,NOW())', [equipmentId, tenant, 'Synthetic fuel rig']);
});
beforeEach(async () => {
  await pool.query('DELETE FROM "TelemetryRecord" WHERE "equipmentId"=$1', [equipmentId]);
  await pool.query('DELETE FROM "FuelLog" WHERE "equipmentId"=$1', [equipmentId]);
});
after(async () => {
  await db.$disconnect();
  await pool.query('DELETE FROM "TelemetryRecord" WHERE "equipmentId"=$1', [equipmentId]);
  await pool.query('DELETE FROM "Equipment" WHERE id=$1', [equipmentId]);
  await pool.query('DELETE FROM "Tenant" WHERE id=ANY($1::text[])', [[tenant, other]]);
  await pool.end();
});
test('no sources: none/insufficient/null on both surfaces', async () => {
  assert.deepEqual(await results(), { liters: null, source: 'none', quality: 'insufficient' });
});
test('one counter is insufficient, two equal counters measure zero', async () => {
  await counter(100, 1);
  assert.equal((await results()).liters, null);
  await counter(100, 2);
  assert.deepEqual(await results(), { liters: 0, source: 'telemetry', quality: 'measured' });
});
test('manual fallback excludes the first fill already in the baseline', async () => {
  await manual(80, 1, 100);
  assert.equal((await results()).liters, null);
  await manual(50, 2, 20);
  assert.deepEqual(await results(), { liters: 80, source: 'manual', quality: 'measured' });
});
test('manual fills at the same timestamp respect createdAt order between tank measurements', async () => {
  await manual(80, 1, 100);
  await manual(null, 1, 20);
  await manual(50, 2);
  assert.deepEqual(await results(), { liters: 80, source: 'manual', quality: 'measured' });
  await manual(null, 2, 30);
  assert.deepEqual(await results(), { liters: 80, source: 'manual', quality: 'measured' });
});
test('before-period baseline plus one inside reading is sufficient', async () => {
  await manual(80, -1, 100);
  await manual(50, 2, 20);
  assert.deepEqual(await results(), { liters: 80, source: 'manual', quality: 'measured' });
});
test('both sources use telemetry alone, including measured zero', async () => {
  await manual(80, 1); await manual(50, 2);
  await counter(100, 1); await counter(100, 2);
  assert.deepEqual(await results(), { liters: 0, source: 'telemetry', quality: 'measured' });
});
test('reset 1000→5 is insufficient; trustworthy manual data remains fallback', async () => {
  await counter(1000, 1); await counter(5, 2);
  assert.equal((await results()).liters, null);
  await manual(80, 1); await manual(50, 2);
  assert.deepEqual(await results(), { liters: 60, source: 'manual', quality: 'measured' });
});
test('half-open window excludes next midnight; alien tenant counter is not read', async () => {
  await counter(100, 0); await counter(125, 23); await counter(9999, 24);
  await counter(10000, 22, other);
  assert.deepEqual(await results(), { liters: 25, source: 'telemetry', quality: 'measured' });
});
test('site-filtered manual-only consumption remains unknown', async () => {
  await manual(80, 1); await manual(50, 2);
  const data = await scoped(() => getEquipmentAnalytics({ tenantId: tenant, dateFrom: '2026-01-01', dateTo: '2026-01-01', timezone: 'UTC', siteId: 'synthetic-site' }));
  assert.equal(data.equipment[0].fuelConsumption.liters, null);
  assert.equal(data.equipment[0].fuelConsumption.quality, 'insufficient');
  assert.equal(data.fleet.fuelLiters, null);
});

test('journal API retains inclusive to while analytics next midnight remains exclusive', async () => {
  await counter(100, 0); await counter(125, 24);
  const journal = await scoped(() => getFuelSummary(equipmentId, tenant, from, to));
  assert.equal(journal.consumption.liters, 25);
  const analytics = await scoped(() => getEquipmentAnalytics({ tenantId: tenant, dateFrom: '2026-01-01', dateTo: '2026-01-01', timezone: 'UTC' }));
  assert.equal(analytics.equipment[0].fuelConsumption.liters, null);
});
