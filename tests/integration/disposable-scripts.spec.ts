import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
describe('disposable database cleanup boundaries', () => {
  it.each(['', 'pilingtrack-postgres', 'codex-pg-../../owner'])('refuses unsafe container name %j before Docker', (name) => {
    const result = spawnSync(bash, ['scripts/test-db-down.sh', name], { encoding: 'utf8' });
    expect(result.status).toBe(64);
    expect(result.stderr).toContain('codex-pg-');
  });
});

const cleanupScript = 'scripts/cleanup-report-analytics-orphans.cjs';
const orphanKeys = [
  '00fc064e-924e-4456-b8d2-79ed2c69bf97',
  '5bf66128-a0d3-403c-8361-13e30c84cd9d',
  '880c6af8-b6df-4820-80a1-b9607b3e2ce3',
  '174f9e42-20d3-44d5-af7c-d6c59b4c97ad',
  'operator-v3-bfc41098-0efc-4f4f-ac02-be5d6d7c9369',
];
const runCleanup = (args: string[], env = process.env) => spawnSync(process.execPath, [cleanupScript, ...args], { encoding: 'utf8', env, timeout: 25_000 });

describe('J7 orphan cleanup command boundaries', () => {
  it.each([[], ['--container', 'pilingtrack-postgres'], ['--container', 'codex-pg-../../owner'], ['--unknown'], ['--apply'], ['--restore'], ['--container', 'codex-pg-012345abcdef', '--apply', '--backup', 'relative.json'], ['--container', 'codex-pg-012345abcdef', '--apply', '--backup', path.join(tmpdir(), '.env.json')], ['--container', 'codex-pg-012345abcdef', '--apply', '--backup', path.join(tmpdir(), '.ENV.json')]].map(args => [args]))('refuses unsafe arguments %j before Docker', (args) => {
    const result = runCleanup(args);
    expect(result.status).toBe(64);
    expect(result.stderr).toContain('Usage:');
  });
});

const ownCleanupEnabled = Boolean(process.env.INTEGRATION_DATABASE_URL_OWNER && process.env.INTEGRATION_DB_CONTAINER);
describe.skipIf(!ownCleanupEnabled)('J7 orphan cleanup real own Postgres', () => {
  const prefix = `codex-j7-${randomBytes(6).toString('hex')}`;
  let directory: string;
  let backup: string;
  const foreignTenant = `${prefix}-tenant`;
  const referenceTable = `codex_j7_${prefix.slice(-12)}`;
  const triggerFunction = `${referenceTable}_fn`;
  const container = process.env.INTEGRATION_DB_CONTAINER as string;
  let db: Client;
  let seeded = false;
  const command = (...args: string[]) => runCleanup(['--container', container, ...args]);
  const snapshot = async () => (await db.query('SELECT to_jsonb(a) AS row FROM "ReportAnalytics" a WHERE id LIKE $1 ORDER BY "reportId"', [`${prefix}-%`])).rows.map(row => row.row);
  const seedTargets = () => db.query(`INSERT INTO "ReportAnalytics" (id,"reportId","tenantId","siteId","userId",status,"totalPiles","totalDrilling","totalDowntime","createdAt","lastEventAt")
    SELECT $1||'-target-'||i, key, 'orion',$1||'-site',$1||'-user','submitted',i,12.375,0.125,'2026-08-10T11:12:13.123Z','2026-08-11T12:13:14.456Z'
    FROM unnest($2::text[]) WITH ORDINALITY AS keys(key,i)`, [prefix, orphanKeys]);

  beforeAll(async () => {
    if (!/^codex-pg-[a-f0-9]{12}$/.test(container)) throw Error('J7 fixture requires own codex-pg container');
    const label = spawnSync('docker', ['inspect', '--format', '{{ index .Config.Labels "pilingtrack.codex.test-db" }}', container], { encoding: 'utf8' });
    if (label.status !== 0 || label.stdout.trim() !== '1') throw Error('J7 fixture ownership label is missing');
    const url = new URL(process.env.INTEGRATION_DATABASE_URL_OWNER as string);
    const port = spawnSync('docker', ['port', container, '5432/tcp'], { encoding: 'utf8' });
    if (url.hostname !== '127.0.0.1' || url.username !== 'piling' || url.pathname !== '/codex_test' || port.status !== 0 || port.stdout.trim() !== `127.0.0.1:${url.port}`) throw Error('J7 fixture endpoint is not the owned container');
    db = new Client({ connectionString: url.toString() });
    await db.connect();
    if ((await db.query('SELECT 1 FROM "Tenant" WHERE id=$1', ['orion'])).rowCount) throw Error('J7 fixture refuses an existing orion tenant');
    if ((await db.query('SELECT 1 FROM "ReportAnalytics" WHERE "reportId"=ANY($1::text[])', [orphanKeys])).rowCount) throw Error('J7 fixture refuses existing target keys');
    if ((await db.query('SELECT 1 FROM "Report" WHERE "reportId"=ANY($1::text[])', [orphanKeys])).rowCount) throw Error('J7 fixture refuses existing report keys');
    directory = mkdtempSync(path.join(tmpdir(), `${prefix}-`));
    backup = path.join(directory, 'rows.json');
    await db.query('BEGIN');
    try {
      await db.query('INSERT INTO "Tenant" (id,slug,name,"updatedAt") VALUES ($1,$1,\'J7 own fixture\',now()),($2,$2,\'J7 foreign fixture\',now())', ['orion', foreignTenant]);
      await db.query('INSERT INTO "User" (id,"tenantId",email,name,"updatedAt") VALUES ($1,$2,$1||\'@example.invalid\',\'J7 fixture\',now())', [`${prefix}-user`, foreignTenant]);
      await db.query('INSERT INTO "Site" (id,"tenantId",name,"updatedAt") VALUES ($1,$2,\'J7 fixture\',now())', [`${prefix}-site`, foreignTenant]);
      await db.query('INSERT INTO "Report" (id,"reportId","tenantId","siteId","userId",date,"updatedAt") VALUES ($1,$1,$2,$3,$4,\'2026-10-07\',now())', [`${prefix}-live`, foreignTenant, `${prefix}-site`, `${prefix}-user`]);
      await db.query(`INSERT INTO "ReportAnalytics" (id,"reportId","tenantId","siteId","userId") VALUES
        ($1||'-unrelated-orphan',$1||'-unrelated-orphan','orion',$1||'-site',$1||'-user'),
        ($1||'-other-tenant',$1||'-other-tenant',$2,$1||'-site',$1||'-user'),
        ($1||'-live',$1||'-live',$2,$1||'-site',$1||'-user')`, [prefix, foreignTenant]);
      await db.query('COMMIT');
      seeded = true;
    } catch (error) { await db.query('ROLLBACK'); throw error; }
  });
  beforeEach(async () => {
    await db.query('DELETE FROM "Report" WHERE id=$1', [`${prefix}-foreign-live`]);
    await db.query('DELETE FROM "ReportAnalytics" WHERE id LIKE $1', [`${prefix}-target-%`]);
    await seedTargets();
    rmSync(backup, { force: true });
  });
  afterAll(async () => {
    if (db) {
      try {
        await db.query(`DROP TABLE IF EXISTS "${referenceTable}"`);
        await db.query(`DROP TRIGGER IF EXISTS "${referenceTable}" ON "ReportAnalytics"`);
        await db.query(`DROP FUNCTION IF EXISTS "${triggerFunction}"()`);
        if (seeded) {
          await db.query('DELETE FROM "ReportAnalytics" WHERE id LIKE $1', [`${prefix}-%`]);
          await db.query('DELETE FROM "Report" WHERE id LIKE $1', [`${prefix}-%`]);
          await db.query('DELETE FROM "Site" WHERE id=$1', [`${prefix}-site`]);
          await db.query('DELETE FROM "User" WHERE id=$1', [`${prefix}-user`]);
          await db.query('DELETE FROM "Tenant" WHERE id=ANY($1::text[])', [['orion', foreignTenant]]);
        }
      } finally { await db.end(); }
    }
    if (directory) {
      const target = path.resolve(directory);
      if (path.dirname(target) !== path.resolve(tmpdir()) || !path.basename(target).startsWith(`${prefix}-`)) throw Error('J7 fixture refuses unsafe temporary directory cleanup');
      rmSync(target, { recursive: true, force: true });
    }
  });

  it('defaults to dry-run, including zero rows, without changing any row', async () => {
    const before = await snapshot();
    expect(command().status).toBe(0);
    expect(await snapshot()).toEqual(before);
    await db.query('DELETE FROM "ReportAnalytics" WHERE id LIKE $1', [`${prefix}-target-%`]);
    expect(command().status).toBe(0);
  });
  it('backs up every column, deletes only five keys and restores exact rows; duplicate restore rolls back', async () => {
    const before = await snapshot();
    const targets = before.filter(row => orphanKeys.includes(row.reportId));
    const applied = command('--apply', '--backup', backup);
    expect(applied.stderr).toBe('');
    expect(applied.status).toBe(0);
    const saved = JSON.parse(readFileSync(backup, 'utf8'));
    expect(saved.content.rows).toEqual(targets);
    expect(saved.sha256).toBe(createHash('sha256').update(JSON.stringify(saved.content)).digest('hex'));
    expect(await snapshot()).toEqual(before.filter(row => !orphanKeys.includes(row.reportId)));
    expect(command('--restore', backup).status).toBe(0);
    expect(await snapshot()).toEqual(before);
    expect(command('--restore', backup).status).toBe(1);
    expect(await snapshot()).toEqual(before);
  });
  it('refuses fewer targets, another tenant and an existing backup without deleting rows', async () => {
    await db.query('DELETE FROM "ReportAnalytics" WHERE "reportId"=$1', [orphanKeys[0]]);
    let before = await snapshot();
    expect(command('--apply', '--backup', backup).status).toBe(1);
    expect(await snapshot()).toEqual(before);
    await db.query('DELETE FROM "ReportAnalytics" WHERE id LIKE $1', [`${prefix}-target-%`]);
    await seedTargets();
    await db.query('UPDATE "ReportAnalytics" SET "tenantId"=$1 WHERE "reportId"=$2', [foreignTenant, orphanKeys[0]]);
    before = await snapshot();
    expect(command('--apply', '--backup', backup).status).toBe(1);
    expect(await snapshot()).toEqual(before);
    await db.query('UPDATE "ReportAnalytics" SET "tenantId"=\'orion\' WHERE "reportId"=$1', [orphanKeys[0]]);
    writeFileSync(backup, 'existing backup');
    before = await snapshot();
    expect(command('--apply', '--backup', backup).status).toBe(1);
    expect(readFileSync(backup, 'utf8')).toBe('existing backup');
    expect(await snapshot()).toEqual(before);
  });
  it('globally detects a live Report in another tenant', async () => {
    await db.query('INSERT INTO "Report" (id,"reportId","tenantId","siteId","userId",date,"updatedAt") VALUES ($1,$2,$3,$4,$5,\'2026-10-08\',now())', [`${prefix}-foreign-live`, orphanKeys[0], foreignTenant, `${prefix}-site`, `${prefix}-user`]);
    const before = await snapshot();
    expect(command('--apply', '--backup', backup).status).toBe(1);
    expect(await snapshot()).toEqual(before);
  });
  it('refuses incoming foreign keys and enabled user triggers', async () => {
    const before = await snapshot();
    await db.query(`CREATE TABLE "${referenceTable}" (id text PRIMARY KEY, "analyticsId" text REFERENCES "ReportAnalytics"(id))`);
    try { expect(command('--apply', '--backup', backup).status).toBe(1); } finally { await db.query(`DROP TABLE "${referenceTable}"`); }
    await db.query(`CREATE FUNCTION "${triggerFunction}"() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN OLD; END'`);
    await db.query(`CREATE TRIGGER "${referenceTable}" BEFORE DELETE ON "ReportAnalytics" FOR EACH ROW EXECUTE FUNCTION "${triggerFunction}"()`);
    try { expect(command('--apply', '--backup', backup).status).toBe(1); } finally {
      await db.query(`DROP TRIGGER "${referenceTable}" ON "ReportAnalytics"`);
      await db.query(`DROP FUNCTION "${triggerFunction}"()`);
    }
    expect(await snapshot()).toEqual(before);
  });
  it('rejects checksum tampering and schema mismatch before restore', async () => {
    expect(command('--apply', '--backup', backup).status).toBe(0);
    const clean = JSON.parse(readFileSync(backup, 'utf8'));
    const before = await snapshot();
    clean.content.rows[0].totalPiles += 1;
    writeFileSync(backup, JSON.stringify(clean));
    expect(command('--restore', backup).status).toBe(1);
    expect(await snapshot()).toEqual(before);
    clean.content.columns = [];
    clean.sha256 = createHash('sha256').update(JSON.stringify(clean.content)).digest('hex');
    writeFileSync(backup, JSON.stringify(clean));
    expect(command('--restore', backup).status).toBe(1);
    expect(await snapshot()).toEqual(before);
  });
});
