// Run inside scripts/test-day-stand.cjs (or an owned copy with output relocated).
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import crypto from 'node:crypto';
import { Client } from 'pg';
import bcrypt from 'bcryptjs';

const dir = path.resolve('output/qa-stabilize-1023');
const container = process.env.INTEGRATION_DB_CONTAINER || '';
const owner = new URL(process.env.INTEGRATION_DATABASE_URL_OWNER || 'http://invalid');
if (!/^codex-pg-[a-f0-9]{12}$/.test(container) || owner.hostname !== '127.0.0.1' || owner.pathname !== '/codex_test' || owner.username !== 'piling') throw Error('Owned disposable database required');
const label = cp.execFileSync('docker', ['inspect', '--format', '{{index .Config.Labels "pilingtrack.codex.test-db"}}', container], { encoding: 'utf8', windowsHide: true }).trim();
if (label !== '1' || new URL(process.env.BASE_URL || 'http://invalid').hostname !== '127.0.0.1') throw Error('Owned local stand required');

const aliases = {};
const credentials = {};
const accounts = [];
function account(role, alias) {
  const email = `qa-${crypto.randomBytes(8).toString('hex')}@example.invalid`;
  aliases[alias] = email;
  credentials[email] = crypto.randomBytes(20).toString('hex');
  accounts.push({ role, email });
  return email;
}
const roles = [
  ['ADMIN', 'qa-hermes-admin@piling.test'], ['DISPATCHER', 'dispatch@piling.ru'],
  ['MECHANIC', 'qa-mechanic@piling.test'], ['FOREMAN', 'qa-foreman@piling.test'],
  ['SAFETY_ENGINEER', 'qa-safety_engineer@piling.test'],
].map(([role, alias]) => ({ role, email: account(role, alias) }));
const operatorVersions = [
  ['operator', '/operator', 'ka@piling.ru', 'helper@piling.ru', 'КБУРГ-16.02 №1'],
  ['operator', '/operator', 'operator@piling.ru', 'qa-hermes-assistant-3@piling.test', 'Bauer RTG RM20'],
  ['v2', '/operator/v2', 'apj@piling.ru', 'tr@piling.ru', 'Liebherr LRH 100 №2'],
  ['v2', '/operator/v2', 'gea@piling.ru', 'qa-hermes-assistant-4@piling.test', 'КБУРГ-16.02 №2'],
  ['v5', '/operator/v5', 'mag@piling.ru', 'kn@piling.ru', 'Kopernik Jint-SD20A'],
  ['v7', '/operator/v7', 'r0mix0n@mail.ru', 'qa-hermes-assistant-2@piling.test', 'Banut 655'],
  ['v10', '/operator/v10', 'ivv@piling.ru', 'qa-hermes-assistant-1@piling.test', 'Woltman-PVE 50PR'],
].map(([version, route, operator, assistant, equipment]) => ({ version, path: route, operator: account('OPERATOR', operator), assistant: account('ASSISTANT', assistant), equipment }));
account('OPERATOR', 'qa-audit-1014-operator@piling.test');
account('ASSISTANT', 'qa-audit-1014-assistant@piling.test');

async function seed() {
  const db = new Client({ connectionString: owner.toString() });
  await db.connect();
  try {
    await db.query('BEGIN');
    const marker = await db.query('SELECT name FROM "Tenant" WHERE id=$1', ['orion']);
    if (marker.rows.length && marker.rows[0].name !== 'Disposable synthetic QA') throw Error('Synthetic marker mismatch');
    async function put(table, row) {
      const keys = Object.keys(row);
      const columns = keys.map(k => `"${k}"`).join(',');
      const values = keys.map((_, i) => '$' + (i + 1)).join(',');
      const update = keys.filter(k => k !== 'id').map(k => `"${k}"=EXCLUDED."${k}"`).join(',');
      await db.query(`INSERT INTO "${table}" (${columns}) VALUES (${values}) ON CONFLICT (id) DO UPDATE SET ${update}`, Object.values(row));
    }
    const now = new Date();
    await put('Tenant', { id: 'orion', slug: 'orion', name: 'Disposable synthetic QA', updatedAt: now });
    await put('TenantSettings', { id: 'qa-settings', tenantId: 'orion', companyName: 'Disposable synthetic QA', notifications: { criticalDefect: false }, updatedAt: now });
    for (const [i, a] of accounts.entries()) await put('User', { id: 'qa-user-' + i, tenantId: 'orion', email: a.email, password: await bcrypt.hash(credentials[a.email], 10), name: 'Synthetic ' + a.role + ' ' + i, role: a.role, updatedAt: now });
    const uid = email => 'qa-user-' + accounts.findIndex(a => a.email === email);
    for (const [i, v] of operatorVersions.entries()) {
      const prefix = 'qa-v' + i;
      await put('Site', { id: prefix + '-site', tenantId: 'orion', name: 'Synthetic QA site ' + i, updatedAt: now });
      await put('Equipment', { id: prefix + '-equipment', tenantId: 'orion', name: v.equipment, kind: 'PILE_DRIVER', model: 'Synthetic fixture', updatedAt: now });
      await put('Crew', { id: prefix + '-crew', name: 'Synthetic QA crew ' + i, operatorId: uid(v.operator), equipmentId: prefix + '-equipment', siteId: prefix + '-site', updatedAt: now });
      await put('CrewAssistant', { id: prefix + '-assistant', crewId: prefix + '-crew', userId: uid(v.assistant), name: 'Synthetic assistant', updatedAt: now });
      for (const [j, email] of [v.operator, v.assistant].entries()) await put('UserSiteAssignment', { id: prefix + '-assign-' + j, userId: uid(email), siteId: prefix + '-site', updatedAt: now });
    }
    for (const [table, id, name, extra] of [['PileGrade', 'qa-grade', 'Synthetic C60', { lengthMm: 6000 }], ['DrillingType', 'qa-drill', 'Synthetic drilling', {}], ['DowntimeReason', 'qa-downtime', 'Synthetic downtime', {}]]) await put(table, { id, tenantId: 'orion', name, normalizedName: name.toLowerCase().replaceAll(' ', ''), ...extra, updatedAt: now });
    await db.query('COMMIT');
  } catch (e) { await db.query('ROLLBACK'); throw e; } finally { await db.end(); }
}

(async () => {
  fs.mkdirSync(dir, { recursive: true });
  await seed();
  const env = { ...process.env, QA_DIR: path.join(dir, 'fixture'), QA_RUN_DIR: path.join(dir, 'run'), QA_MATRIX_JSON: JSON.stringify({ roles, operatorVersions, excluded: [] }), QA_CREDENTIALS_JSON: JSON.stringify(credentials), QA_ACCOUNT_ALIASES_JSON: JSON.stringify(aliases), POST_MERGE_SMOKE: '1', PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || 'D:/PillingR/tools/ms-playwright' };
  const healthPort = Number(env.WORKER_HEALTH_PORT);
  if (!Number.isInteger(healthPort) || healthPort < 1 || healthPort > 65535) throw Error('Stand worker health port required');
  const hasWorker = await fetch(`http://127.0.0.1:${healthPort}/health`, { signal: AbortSignal.timeout(1000) }).then(r => r.ok).catch(() => false);
  const worker = hasWorker ? undefined : cp.spawn(process.execPath, ['--import', 'tsx', 'src/workers/unified-worker.ts'], { env, stdio: 'inherit', windowsHide: true });
  const stop = () => { if (worker?.exitCode === null) cp.spawnSync('taskkill', ['/PID', String(worker.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); };
  process.on('exit', stop);
  const args = ['e2e/fixtures/disposable-https.mjs', 'node_modules/@playwright/test/cli.js', 'test', '-c', 'playwright.qa-disposable.config.ts', '--workers=1', ...process.argv.slice(2)];
  const child = cp.spawn(process.execPath, args, { env, stdio: 'inherit', windowsHide: true });
  child.on('error', e => { stop(); console.error(e.message); process.exitCode = 1; });
  child.on('exit', code => { stop(); fs.writeFileSync(path.join(dir, 'qa-195.exit'), String(code ?? 1)); process.exitCode = code ?? 1; });
})().catch(e => { console.error(e.message); process.exitCode = 1; });
