const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { capture } = require('./db-drill-manifest.cjs');

async function main() {
  const [dump, manifestPath, container] = process.argv.slice(2);
  const expected = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const digest = createHash('sha256').update(readFileSync(dump)).digest('hex');
  const keys = ['Report', 'Site', 'Equipment', 'Inspection', 'Shift', 'AuditLog', '_prisma_migrations'];
  if (expected.version !== 1 || digest !== expected.dumpSha256 || !Array.isArray(expected.snapshot?.migrations) || !expected.snapshot.migrations.length || !keys.every(key => /^\d+$/.test(expected.snapshot?.counts?.[key] || ''))) {
    throw Error('Dump digest or snapshot manifest is invalid');
  }
  if (!container) { console.log('Dump digest and snapshot manifest verified'); return; }
  if (!/^codex-pg-[a-f0-9]{12}$/.test(container)) throw Error('Only a codex-pg test container can be verified');
  const inspect = spawnSync('docker', ['inspect', '--format', '{{ index .Config.Labels "pilingtrack.codex.test-db" }}', container], { encoding: 'utf8' });
  if (inspect.status !== 0 || inspect.stdout.trim() !== '1') throw Error('Disposable container ownership label is missing');
  const sql = statement => {
    const result = spawnSync('docker', ['exec', container, 'psql', '-U', 'piling', '-d', 'codex_test', '-v', 'ON_ERROR_STOP=1', '-q', '-A', '-t', '-c', statement], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (result.status !== 0) throw Error('Restored database query failed: ' + result.stderr);
    return result.stdout.trim();
  };
  const query = async statement => JSON.parse(sql(`SELECT coalesce(json_agg(row), '[]'::json) FROM (${statement}) row`));
  const actual = await capture(query);
  for (const key of ['counts', 'migrations', 'rls', 'policies']) {
    if (!isDeepStrictEqual(actual[key], expected.snapshot[key])) throw Error(`Restore mismatch in ${key}`);
  }
  const roles = await query("SELECT rolname, rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname IN ('pilingtrack_app','pilingtrack_identity') ORDER BY rolname");
  if (!isDeepStrictEqual(roles, [
    { rolname: 'pilingtrack_app', rolsuper: false, rolbypassrls: false, rolcanlogin: true },
    { rolname: 'pilingtrack_identity', rolsuper: false, rolbypassrls: true, rolcanlogin: false },
  ])) throw Error('Restored application/identity roles are incorrect');
  for (const key of keys.filter(key => key !== '_prisma_migrations')) {
    const count = sql(`BEGIN; SET LOCAL ROLE pilingtrack_app; SELECT count(*) FROM "${key}"; ROLLBACK;`);
    if (count !== '0') throw Error(`Restored ${key} is not fail-closed without a tenant`);
    console.log(`${key}: source=${actual.counts[key]}, restored=${actual.counts[key]}, app without tenant=0`);
  }
  console.log(`RESTORE OK: ${Object.keys(actual.counts).length} tables, ${actual.migrations.length} migrations, ${actual.policies.length} RLS policies; all counts, migration checksums and RLS definitions match`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
