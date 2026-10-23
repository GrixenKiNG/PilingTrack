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
const history = {
  tenantId: 'orion',
  date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()),
  reports: [], totalPiles: 14, totalPileMeters: 196, drillingCount: 6, drillingMeters: 21, downtimeHours: 1.5,
};
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
    await put('PileGrade', { id: 'qa-history-grade', tenantId: history.tenantId, name: 'Synthetic C140', normalizedName: 'syntheticc140', lengthMm: 14000, updatedAt: now });
    for (const [n, i] of [0, 1, 5].entries()) {
      const prefix = 'qa-v' + i;
      const shiftId = prefix + '-history-shift';
      const reportId = prefix + '-history-report';
      const publicId = `SYNTHETIC-${i}-${history.date}`;
      const piles = [5, 7, 2][n];
      const start = new Date(`${history.date}T0${6 + n}:00:00+03:00`);
      const end = new Date(start.getTime() + 3600000);
      const operatorId = uid(operatorVersions[i].operator);
      await put('PileField', { id: prefix + '-field', siteId: prefix + '-site', name: 'Synthetic field ' + i, updatedAt: now });
      await put('Cluster', { id: prefix + '-cluster', fieldId: prefix + '-field', name: 'Synthetic cluster ' + i, updatedAt: now });
      await put('Picket', { id: prefix + '-picket', clusterId: prefix + '-cluster', name: 'Synthetic picket ' + i, updatedAt: now });
      await put('Shift', { id: shiftId, tenantId: history.tenantId, equipmentId: prefix + '-equipment', type: 'DAY', state: 'CLOSED', productionDate: history.date, timezone: 'Europe/Moscow', createdById: uid(roles[1].email), lastEditedById: uid(roles[1].email), startedAt: start, closedAt: end, updatedAt: now });
      await put('Report', { id: reportId, tenantId: history.tenantId, reportId: publicId, userId: operatorId, crewId: prefix + '-crew', equipmentId: prefix + '-equipment', siteId: prefix + '-site', date: history.date, shiftId, shiftStart: `${6 + n}:00`, shiftEnd: `${7 + n}:00`, status: 'submitted', submittedAt: end, updatedAt: now });
      for (const [j, count] of [1, piles - 1].entries()) {
        const workId = prefix + '-history-pile-' + j;
        await put('PileWork', { id: workId, reportId, tenantId: history.tenantId, shiftId, picketId: prefix + '-picket', pileGradeId: 'qa-history-grade', count, occurredAt: start, receivedAt: start });
        if (j === 0) await put('PilePassport', { id: prefix + '-passport', tenantId: history.tenantId, pileWorkId: workId, clientCommandId: prefix + '-passport-command', pileNumber: `SYNTHETIC_${i}_1`, drivenAt: start, drivenDepthM: 14, recordedById: operatorId, updatedAt: now });
      }
      await put('LeaderDrilling', { id: prefix + '-history-drill', reportId, tenantId: history.tenantId, shiftId, picketId: prefix + '-picket', typeId: 'qa-drill', count: 2, metersPerUnit: 3.5, meters: 7, occurredAt: start });
      await put('ReportDowntime', { id: prefix + '-history-downtime', reportId, tenantId: history.tenantId, shiftId, reasonId: 'qa-downtime', duration: 0.5, occurredAt: start });
      await put('ReportAnalytics', { id: prefix + '-history-analytics', reportId: publicId, tenantId: history.tenantId, siteId: prefix + '-site', userId: operatorId, status: 'submitted', totalPiles: piles, totalDrilling: 7, totalDowntime: 0.5 });
      await db.query('INSERT INTO "SiteDailySummary" (id,"siteId",date,"totalPiles","totalDrilling","totalDowntime","reportCount","updatedAt") VALUES ($1,$2,$3,$4,7,0.5,1,$5) ON CONFLICT ("siteId",date) DO UPDATE SET "totalPiles"=EXCLUDED."totalPiles","totalDrilling"=7,"totalDowntime"=0.5,"reportCount"=1,"updatedAt"=EXCLUDED."updatedAt"', [prefix + '-daily', prefix + '-site', history.date, piles, now]);
      history.reports.push({ id: publicId, shiftId, equipmentId: prefix + '-equipment', equipment: operatorVersions[i].equipment, operator: 'Synthetic OPERATOR ' + accounts.findIndex(a => a.email === operatorVersions[i].operator), piles, pileMeters: piles * 14, pileNumber: `SYNTHETIC_${i}_1` });
    }
    await db.query('COMMIT');
  } catch (e) { await db.query('ROLLBACK'); throw e; } finally { await db.end(); }
}

(async () => {
  fs.mkdirSync(dir, { recursive: true });
  await seed();
  fs.writeFileSync(path.join(dir, 'history-manifest.json'), JSON.stringify(history, null, 2));
  const env = { ...process.env, QA_HISTORY_JSON: JSON.stringify(history), QA_DIR: path.join(dir, 'fixture'), QA_RUN_DIR: path.join(dir, 'run'), QA_MATRIX_JSON: JSON.stringify({ roles, operatorVersions, excluded: [] }), QA_CREDENTIALS_JSON: JSON.stringify(credentials), QA_ACCOUNT_ALIASES_JSON: JSON.stringify(aliases), POST_MERGE_SMOKE: '1', PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || 'D:/PillingR/tools/ms-playwright' };
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
