// Produce a gzip-wrapped custom dump, matching scripts/backup-postgres.sh.
// Both counts and pg_dump use one exported, read-only repeatable-read snapshot.
const { Client } = require('pg');
const { spawnSync } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const { gzipSync } = require('node:zlib');
const { createHash } = require('node:crypto');
const { capture } = require('./db-drill-manifest.cjs');

async function main() {
  const [container, destination] = process.argv.slice(2);
  if (!/^codex-pg-[a-f0-9]{12}$/.test(container || '') || !destination) throw Error('Usage: node scripts/test-db-dump.cjs codex-pg-<12 hex> /path/dump.sql.gz');
  const url = new URL(process.env.INTEGRATION_DATABASE_URL_OWNER || '');
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/codex_test' || url.username !== 'piling') throw Error('Only local codex_test as piling is allowed');
  const inspect = spawnSync('docker', ['inspect', '--format', '{{ index .Config.Labels "pilingtrack.codex.test-db" }}', container], { encoding: 'utf8' });
  if (inspect.status !== 0 || inspect.stdout.trim() !== '1') throw Error('Container does not carry the disposable test-db label');
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const [{ snapshot }] = (await client.query('SELECT pg_export_snapshot() AS snapshot')).rows;
    const manifest = await capture(async sql => (await client.query(sql)).rows);
    const dump = spawnSync('docker', ['exec', container, 'pg_dump', '-U', 'piling', '-d', 'codex_test', '-F', 'c', '--snapshot', snapshot], { maxBuffer: 64 * 1024 * 1024 });
    if (dump.status !== 0) throw Error('pg_dump failed: ' + dump.stderr.toString());
    const compressed = gzipSync(dump.stdout);
    writeFileSync(destination, compressed, { flag: 'wx' });
    writeFileSync(destination + '.manifest.json', JSON.stringify({ version: 1, dumpSha256: createHash('sha256').update(compressed).digest('hex'), snapshot: manifest }, null, 2), { flag: 'wx' });
    console.log(`Synthetic dump: ${Object.keys(manifest.counts).length} tables, ${manifest.migrations.length} migrations, ${compressed.length} bytes`);
  } finally { await client.query('ROLLBACK'); await client.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
