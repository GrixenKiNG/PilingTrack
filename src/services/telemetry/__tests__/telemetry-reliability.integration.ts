/** Run explicitly with node --import tsx --test <this file>, on test-db-up.sh only. */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { Pool } from 'pg';

const ownerUrl = process.env.INTEGRATION_DATABASE_URL_OWNER;
const appUrl = process.env.INTEGRATION_DATABASE_URL_APP;
for (const value of [ownerUrl, appUrl]) {
  assert.ok(value, 'Disposable owner/app URLs are required; no silent skips');
  const parsed = new URL(value);
  assert.ok(['127.0.0.1', 'localhost'].includes(parsed.hostname));
  assert.equal(parsed.pathname, '/codex_test');
}
assert.match(process.env.INTEGRATION_DB_CONTAINER ?? '', /^codex-pg-[a-f0-9]{12}$/);
const pool = new Pool({ connectionString: ownerUrl, max: 2 });
const tenantId = `telemetry-contract-${randomUUID()}`;
const children = new Set<ChildProcess>();
type Reply = { id: number; pid: number; ids: string[]; stats: { buffered: number; flushed: number; dropped: number }; error?: string };
type RecordInput = { tenantId: string; equipmentId: string; type: string; value: number; timestamp: Date; metadata: { deviceId: string } };

async function worker() {
  const child = spawn(process.execPath, ['--import', 'tsx', path.resolve('src/services/telemetry/__tests__/telemetry-process.fixture.ts')], {
    env: { ...process.env, DATABASE_URL: appUrl, DATABASE_URL_POSTGRES: appUrl },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  children.add(child);
  let stderr = '';
  child.stderr?.on('data', chunk => { stderr += chunk.toString(); });
  // Drain application logs without confusing them with the IPC protocol.
  child.stdout?.resume();
  let sequence = 0;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`worker startup timeout: ${stderr}`)), 30_000);
    child.once('message', () => { clearTimeout(timer); resolve(); });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`worker exited ${code}: ${stderr}`)); });
  });
  return {
    child,
    command(action: string, records: RecordInput[] = []) {
      const id = ++sequence;
      return new Promise<Reply>((resolve, reject) => {
        const timer = setTimeout(() => { child.off('message', listener); reject(new Error('worker command timeout')); }, 30_000);
        const listener = (reply: Reply) => {
          if (reply.id !== id) return;
          clearTimeout(timer);
          child.off('message', listener);
          if (reply.error) reject(new Error(reply.error));
          else resolve(reply);
        };
        child.on('message', listener);
        child.send({ id, action, records });
      });
    },
    async kill() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
      children.delete(child);
    },
  };
}

function record(equipmentId: string, value = 10, timestamp = new Date('2026-10-23T00:00:00Z')): RecordInput {
  return { tenantId, equipmentId, type: 'fuel_total', value, timestamp, metadata: { deviceId: 'synthetic-device' } };
}
async function rows(equipmentId: string) {
  const result = await pool.query<{ value: number; timestamp: Date }>(
    'SELECT value, timestamp FROM "TelemetryRecord" WHERE "tenantId"=$1 AND "equipmentId"=$2 ORDER BY timestamp, value',
    [tenantId, equipmentId],
  );
  return result.rows;
}
before(async () => {
  await pool.query('INSERT INTO "Tenant" (id, slug, name, "updatedAt") VALUES ($1,$1,$1,NOW())', [tenantId]);
});
after(async () => {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
    }
  }
  await pool.query('DELETE FROM "TelemetryRecord" WHERE "tenantId"=$1', [tenantId]);
  await pool.query('DELETE FROM "Tenant" WHERE id=$1', [tenantId]);
  await pool.end();
});

test('buffered acknowledgement precedes durable write; explicit flush persists', async () => {
  const w = await worker();
  try {
    const accepted = await w.command('ingest', [record('ack')]);
    assert.match(accepted.ids[0], /^buffered-/);
    assert.equal(accepted.stats.buffered, 1);
    assert.equal((await rows('ack')).length, 0);
    const flushed = await w.command('flush');
    assert.deepEqual(flushed.stats, { buffered: 0, flushed: 1, dropped: 0 });
    assert.equal((await rows('ack')).length, 1);
  } finally { await w.kill(); }
});

test('forced termination loses an acknowledged buffer; restarted process has no replay', async () => {
  const first = await worker();
  await first.command('ingest', [record('crash')]);
  await first.kill();
  assert.equal((await rows('crash')).length, 0);
  const restarted = await worker();
  try {
    assert.equal((await restarted.command('flush')).stats.buffered, 0);
    assert.equal((await rows('crash')).length, 0);
  } finally { await restarted.kill(); }
});

test('explicit graceful shutdown flushes to PostgreSQL', async () => {
  const w = await worker();
  try {
    await w.command('ingest', [record('graceful')]);
    assert.equal((await w.command('shutdown')).stats.flushed, 1);
    assert.equal((await rows('graceful')).length, 1);
  } finally { await w.kill(); }
});

test('OPEN breaker drops oldest quarter; retained records persist after recovery', async () => {
  const w = await worker();
  try {
    const accepted = await w.command('overflow', [1, 2, 3, 4].map(value => record('overflow', value)));
    assert.deepEqual(accepted.stats, { buffered: 3, flushed: 0, dropped: 1 });
    assert.equal((await rows('overflow')).length, 0);
    assert.equal((await w.command('flush')).stats.flushed, 3);
    assert.deepEqual((await rows('overflow')).map(row => row.value), [2, 3, 4]);
  } finally { await w.kill(); }
});

test('duplicate deviceId/timestamp is currently stored twice (target deduplication gap)', async () => {
  const w = await worker();
  try {
    const duplicate = record('duplicate');
    await w.command('ingest', [duplicate, duplicate]);
    await w.command('flush');
    assert.equal((await rows('duplicate')).length, 2);
  } finally { await w.kill(); }
});

test('counter reset is retained as raw data without correcting the counter', async () => {
  const w = await worker();
  try {
    await w.command('ingest', [record('reset', 1000), record('reset', 5, new Date('2026-10-23T00:01:00Z'))]);
    await w.command('flush');
    assert.deepEqual((await rows('reset')).map(row => row.value), [1000, 5]);
  } finally { await w.kill(); }
});

test('clock skew and out-of-order timestamps are retained unchanged', async () => {
  const w = await worker();
  try {
    const dates = ['2026-10-23T00:00:00Z', '2036-01-01T00:00:00Z', '2000-01-01T00:00:00Z'];
    await w.command('ingest', dates.map((date, i) => record('clocks', i, new Date(date))));
    await w.command('flush');
    assert.deepEqual((await rows('clocks')).map(row => row.timestamp.toISOString()), dates.map(date => new Date(date).toISOString()).sort());
  } finally { await w.kill(); }
});

test('two live processes own independent buffers and both persist the same event', async () => {
  const [first, second] = await Promise.all([worker(), worker()]);
  try {
    const event = record('multiprocess');
    const accepted = await Promise.all([first.command('ingest', [event]), second.command('ingest', [event])]);
    assert.notEqual(accepted[0].pid, accepted[1].pid);
    assert.deepEqual(accepted.map(reply => reply.stats.buffered), [1, 1]);
    assert.equal((await rows('multiprocess')).length, 0);
    await Promise.all([first.command('flush'), second.command('flush')]);
    assert.equal((await rows('multiprocess')).length, 2);
  } finally { await Promise.all([first.kill(), second.kill()]); }
});
