// J7 rehearsal only: five W12 keys, never a shared or production database.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const keys = [
  '00fc064e-924e-4456-b8d2-79ed2c69bf97',
  '5bf66128-a0d3-403c-8361-13e30c84cd9d',
  '880c6af8-b6df-4820-80a1-b9607b3e2ce3',
  '174f9e42-20d3-44d5-af7c-d6c59b4c97ad',
  'operator-v3-bfc41098-0efc-4f4f-ac02-be5d6d7c9369',
].sort();
const tenant = 'orion';
const usage = 'Usage: node scripts/cleanup-report-analytics-orphans.cjs --container codex-pg-<12 hex> [--apply --backup ABS.json | --restore ABS.json]';
const fail = (message, exitCode = 1) => { throw Object.assign(new Error(message), { j7: true, exitCode }); };
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const sorted = rows => rows.sort((a, b) => a.reportId < b.reportId ? -1 : a.reportId > b.reportId ? 1 : 0);
const quote = name => '"' + name.replaceAll('"', '""') + '"';

function argumentsFor(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!['--container', '--apply', '--backup', '--restore'].includes(arg) || Object.hasOwn(options, arg)) fail(usage, 64);
    options[arg] = arg === '--apply' ? true : args[++i];
    if (!options[arg] || (typeof options[arg] === 'string' && options[arg].startsWith('--'))) fail(usage, 64);
  }
  if (!/^codex-pg-[a-f0-9]{12}$/.test(options['--container'] || '') ||
      Boolean(options['--apply']) !== Boolean(options['--backup']) ||
      (options['--restore'] && options['--apply'])) fail(usage, 64);
  const file = options['--backup'] || options['--restore'];
  if (file && (!path.isAbsolute(file) || path.extname(file) !== '.json' || file.split(/[\\/]/).some(part => /^\.env/i.test(part)))) fail(usage, 64);
  return options;
}

function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 10_000 });
  if (result.status !== 0) fail('Owned container inspection failed');
  return result.stdout.trim();
}

function ownedConnection(container) {
  if (docker(['inspect', '--format', '{{ index .Config.Labels "pilingtrack.codex.test-db" }} {{ .State.Running }}', container]) !== '1 true') fail('Running test-db ownership label is required');
  const endpoint = docker(['port', container, '5432/tcp']);
  let url;
  try { url = new URL(process.env.INTEGRATION_DATABASE_URL_OWNER || ''); } catch { fail('Disposable owner connection is required'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1' ||
      url.username !== 'piling' || url.pathname !== '/codex_test' || !url.port || url.search || url.hash ||
      endpoint !== `127.0.0.1:${url.port}`) fail('Owner connection must match the labelled local codex_test container');
  return url.toString();
}

function validateRows(rows, columns) {
  const names = columns.map(column => column.name).sort();
  if (!Array.isArray(rows) || rows.length !== 5 || !same(rows.map(row => row.reportId).sort(), keys) ||
      new Set(rows.map(row => row.id)).size !== 5 || rows.some(row =>
        row.tenantId !== tenant || typeof row.id !== 'string' || !row.id || !same(Object.keys(row).sort(), names))) fail('Backup must contain all columns of exactly five distinct orion rows');
}

function readBackup(file) {
  let saved;
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { fail('Backup cannot be read as JSON'); }
  if (!saved?.content || saved.sha256 !== digest(saved.content) || saved.content.version !== 1 ||
      saved.content.tenant !== tenant || !same(saved.content.keys, keys) || !Array.isArray(saved.content.columns)) fail('Backup checksum or J7 identity is invalid');
  validateRows(saved.content.rows, saved.content.columns);
  return saved.content;
}

function writeBackup(file, content) {
  let fd;
  try {
    fd = fs.openSync(file, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify({ content, sha256: digest(content) }) + '\n');
    fs.fsyncSync(fd);
  } catch { fail('Exclusive durable backup failed; no rows deleted'); }
  finally { if (fd !== undefined) fs.closeSync(fd); }
  if (!same(readBackup(file), content)) fail('Backup verification failed; no rows deleted');
}

async function main() {
  const options = argumentsFor(process.argv.slice(2));
  const saved = options['--restore'] ? readBackup(options['--restore']) : null;
  const connectionString = ownedConnection(options['--container']);
  const { Client } = require('pg');
  const db = new Client({ connectionString, connectionTimeoutMillis: 10_000 });
  let transaction = false;
  try {
    await db.connect();
    const role = (await db.query("SELECT current_user AS name, current_database() AS database, rolsuper OR rolbypassrls AS global FROM pg_roles WHERE rolname=current_user")).rows[0];
    if (role?.name !== 'piling' || role.database !== 'codex_test' || !role.global) fail('Existing disposable owner must see Report globally');
    await db.query('BEGIN');
    transaction = true;
    await db.query("SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='15s'; SET LOCAL idle_in_transaction_session_timeout='30s'; SET LOCAL TIME ZONE 'UTC'; SET LOCAL search_path=pg_catalog,public");
    await db.query("SELECT set_config('app.current_tenant',$1,true)", [tenant]);
    await db.query('LOCK TABLE public."Report" IN SHARE MODE; LOCK TABLE public."ReportAnalytics" IN SHARE ROW EXCLUSIVE MODE');
    const references = await db.query("SELECT 1 FROM pg_constraint WHERE contype='f' AND confrelid='public.\"ReportAnalytics\"'::regclass");
    if (references.rowCount) fail('Incoming foreign keys require separate review');
    const triggers = await db.query("SELECT 1 FROM pg_trigger WHERE tgrelid='public.\"ReportAnalytics\"'::regclass AND NOT tgisinternal AND tgenabled<>'D'");
    if (triggers.rowCount) fail('Enabled user triggers require separate review');
    const columns = (await db.query(`SELECT a.attname AS name, format_type(a.atttypid,a.atttypmod) AS type, a.attnotnull AS "notNull", pg_get_expr(d.adbin,d.adrelid) AS "default"
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid='public."ReportAnalytics"'::regclass AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`)).rows;
    const rows = sorted((await db.query('SELECT to_jsonb(a) AS row FROM public."ReportAnalytics" a WHERE "tenantId"=$1 AND "reportId"=ANY($2::text[])', [tenant, keys])).rows.map(row => row.row));
    const liveReports = await db.query('SELECT 1 FROM public."Report" WHERE "reportId"=ANY($1::text[])', [keys]);
    if (!options['--apply'] && !saved) {
      process.stdout.write(`DRY-RUN: selected=${rows.length}, liveReports=${liveReports.rowCount}; no backup or deletion\n`);
      await db.query('ROLLBACK');
      transaction = false;
      return;
    }
    if (liveReports.rowCount) fail('Known key has a live Report; refusing cleanup or restore');
    if (saved) {
      if (!same(saved.columns, columns)) fail('Backup schema does not match ReportAnalytics');
      const existing = await db.query('SELECT 1 FROM public."ReportAnalytics" WHERE "reportId"=ANY($1::text[]) OR id=ANY($2::text[])', [keys, saved.rows.map(row => row.id)]);
      if (existing.rowCount) fail('Restore conflicts with existing rows; no overwrite');
      const names = columns.map(column => quote(column.name)).join(',');
      const inserted = await db.query(`INSERT INTO public."ReportAnalytics" (${names}) SELECT ${names} FROM jsonb_populate_recordset(NULL::public."ReportAnalytics",$1::jsonb) RETURNING to_jsonb("ReportAnalytics") AS row`, [JSON.stringify(saved.rows)]);
      if (!same(sorted(inserted.rows.map(row => row.row)), saved.rows)) fail('Restored rows do not exactly match the backup');
    } else {
      validateRows(rows, columns);
      const content = { version: 1, tenant, keys, columns, rows };
      writeBackup(options['--backup'], content);
      const deleted = await db.query(`DELETE FROM public."ReportAnalytics" a WHERE "tenantId"=$1 AND "reportId"=ANY($2::text[])
        AND NOT EXISTS(SELECT 1 FROM public."Report" r WHERE r."reportId"=a."reportId") RETURNING to_jsonb(a) AS row`, [tenant, keys]);
      if (!same(sorted(deleted.rows.map(row => row.row)), rows)) fail('Deleted rows do not exactly match the backup');
      const remaining = await db.query('SELECT 1 FROM public."ReportAnalytics" WHERE "reportId"=ANY($1::text[])', [keys]);
      if (remaining.rowCount) fail('Cleanup verification found remaining known keys');
    }
    await db.query('COMMIT');
    transaction = false;
    process.stdout.write(`${saved ? 'RESTORED' : 'DELETED'}: exactly 5 rows; backup ${saved ? options['--restore'] : options['--backup']}\n`);
  } finally {
    if (transaction) await db.query('ROLLBACK').catch(() => {});
    await db.end();
  }
}
main().catch(error => {
  process.stderr.write((error.j7 ? error.message : `J7 operation failed (${error.code || 'database/filesystem error'}); credentials are not logged`) + '\n');
  process.exitCode = error.exitCode || 1;
});
