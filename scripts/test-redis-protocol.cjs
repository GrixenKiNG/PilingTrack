const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const Redis = require('ioredis');
const { Queue, Worker } = require('bullmq');

const root = path.resolve(__dirname, '..');
const suffix = crypto.randomUUID().replaceAll('-', '');
const containerName = `codex-t16-redis-${suffix}`;
const prefix = `t16:${suffix}:`;
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 30000 }).trim();
let containerId;
let client;
let queue;
let worker;
let queueClient;
let workerClient;
let passed = 0;
let failed = 0;

async function check(name, run) {
  try {
    await run();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed++;
    console.error(`FAIL ${name}: ${error.stack}`);
  }
}

async function main() {
  console.log(JSON.stringify({ ioredis: require('ioredis/package.json').version, bullmq: require('bullmq/package.json').version, protocol: 2 }));
  containerId = docker('run', '-d', '--name', containerName, '--label', `codex.owner=${suffix}`, '-p', '127.0.0.1::6379', 'redis:7-alpine', 'redis-server', '--save', '', '--appendonly', 'no');
  const metadata = JSON.parse(docker('inspect', containerId))[0];
  assert.equal(metadata.Config.Labels['codex.owner'], suffix);
  const binding = metadata.NetworkSettings.Ports['6379/tcp'][0];
  assert.equal(binding.HostIp, '127.0.0.1');
  const url = `redis://127.0.0.1:${binding.HostPort}`;
  console.log(JSON.stringify({ container: containerName, containerId, url }));
  client = new Redis(url, { protocol: 2, lazyConnect: true, maxRetriesPerRequest: 3, connectTimeout: 5000 });
  client.on('error', () => {});
  await client.connect();
  const info = await client.info('server');
  assert.match(info, /redis_version:7\./);
  console.log(info.match(/redis_version:[^\r\n]+/)[0]);

  await check('SET/GET revocation marker remains string and missing key null', async () => {
    assert.equal(await client.get(`${prefix}missing`), null);
    assert.equal(await client.set(`${prefix}revoked`, '1', 'EX', 60), 'OK');
    assert.equal(await client.get(`${prefix}revoked`), '1');
    assert.equal(typeof await client.get(`${prefix}revoked`), 'string');
  });
  await check('TTL/PTTL are numbers; missing=-2 and permanent=-1', async () => {
    const ttl = await client.ttl(`${prefix}revoked`);
    const pttl = await client.pttl(`${prefix}revoked`);
    assert.equal(typeof ttl, 'number');
    assert.equal(typeof pttl, 'number');
    assert.ok(ttl > 0 && ttl <= 60);
    assert.ok(pttl > 0 && pttl <= 60000);
    assert.equal(await client.ttl(`${prefix}missing`), -2);
    await client.set(`${prefix}permanent`, 'value');
    assert.equal(await client.ttl(`${prefix}permanent`), -1);
  });
  await check('INCR counter is numeric; GET counter is string', async () => {
    assert.equal(await client.incr(`${prefix}counter`), 1);
    assert.equal(await client.incr(`${prefix}counter`), 2);
    assert.equal(await client.get(`${prefix}counter`), '2');
  });
  await check('SETEX session JSON round-trip and expiry', async () => {
    const data = { userId: 'local-fixture', sessionVersion: 3, expiresAt: 1720000000 };
    assert.equal(await client.setex(`${prefix}session`, 60, JSON.stringify(data)), 'OK');
    const raw = await client.get(`${prefix}session`);
    assert.equal(typeof raw, 'string');
    assert.deepEqual(JSON.parse(raw), data);
    assert.ok(await client.ttl(`${prefix}session`) > 0);
    await client.set(`${prefix}expires`, '1', 'PX', 30);
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(await client.get(`${prefix}expires`), null);
  });
  await check('pipeline and MULTI preserve error/value tuple shape', async () => {
    const result = await client.pipeline().set(`${prefix}pipeline`, '1').incr(`${prefix}pipeline`).get(`${prefix}pipeline`).exec();
    assert.deepEqual(result, [[null, 'OK'], [null, 2], [null, '2']]);
    assert.deepEqual(await client.multi().set(`${prefix}multi`, '4').incr(`${prefix}multi`).exec(), [[null, 'OK'], [null, 5]]);
  });
  const source = fs.readFileSync(path.join(root, 'src/lib/rate-limiter.ts'), 'utf8');
  const lua = source.match(/const RATE_LIMIT_LUA = `([\s\S]*?)`;/)?.[1];
  assert.ok(lua, 'Extract exact application limiter Lua without importing app/env');
  let sha;
  await check('SCRIPT LOAD returns SHA string and EVALSHA allowed numeric tuple', async () => {
    sha = await client.script('LOAD', lua);
    assert.match(sha, /^[0-9a-f]{40}$/);
    assert.deepEqual(await client.evalsha(sha, 2, `${prefix}rl`, `${prefix}block`, '2', '60000', '90000', '1000'), [0, 1, 0]);
    assert.deepEqual(await client.evalsha(sha, 2, `${prefix}rl`, `${prefix}block`, '2', '60000', '90000', '1001'), [0, 0, 0]);
  });
  await check('exact limiter Lua blocks, stores string deadline and positive expiry', async () => {
    assert.deepEqual(await client.evalsha(sha, 2, `${prefix}rl`, `${prefix}block`, '2', '60000', '90000', '1002'), [1, 0, 91002]);
    assert.equal(await client.get(`${prefix}block`), '91002');
    assert.equal(await client.get(`${prefix}rl`), null);
    assert.ok(await client.pttl(`${prefix}block`) > 0);
    assert.deepEqual(await client.evalsha(sha, 2, `${prefix}rl`, `${prefix}block`, '2', '60000', '90000', '1003'), [1, 0, 91002]);
  });
  await check('exact limiter Lua EVAL fallback and expired-block recovery', async () => {
    assert.deepEqual(await client.eval(lua, 2, `${prefix}rl`, `${prefix}block`, '2', '60000', '90000', '91003'), [0, 1, 0]);
    assert.equal(await client.get(`${prefix}block`), null);
    assert.equal(await client.get(`${prefix}rl`), '1');
  });
  await check('session revocation keyPrefix remains separate and readable', async () => {
    const revocations = new Redis(url, { protocol: 2, keyPrefix: `${prefix}pilingtrack:`, lazyConnect: true, enableOfflineQueue: false, maxRetriesPerRequest: 2 });
    revocations.on('error', () => {});
    try {
      await revocations.connect();
      assert.equal(await revocations.set('revoked-jti:local-fixture', '1', 'EX', 60), 'OK');
      assert.equal(await revocations.get('revoked-jti:local-fixture'), '1');
      assert.equal(await client.get(`${prefix}pilingtrack:revoked-jti:local-fixture`), '1');
    } finally { await revocations.quit(); }
  });
  await check('real BullMQ Queue/Worker completes and persists job result', async () => {
    queueClient = new Redis(url, { protocol: 2, maxRetriesPerRequest: null });
    workerClient = new Redis(url, { protocol: 2, maxRetriesPerRequest: null });
    queueClient.on('error', () => {});
    workerClient.on('error', () => {});
    const name = `t16-${suffix}`;
    queue = new Queue(name, { connection: queueClient });
    worker = new Worker(name, async job => ({ total: job.data.a + job.data.b, label: 'completed-fixture' }), { connection: workerClient });
    worker.on('error', () => {});
    await Promise.all([queue.waitUntilReady(), worker.waitUntilReady()]);
    let timeout;
    const completion = new Promise((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('BullMQ completion timeout 15s')), 15000);
      worker.once('completed', (job, result) => resolve({ job, result }));
      worker.once('failed', (_job, error) => reject(error));
    });
    try {
      const job = await queue.add('protocol-check', { a: 17, b: 25 }, { jobId: `job-${suffix}` });
      const completed = await completion;
      assert.equal(completed.job.id, job.id);
      assert.deepEqual(completed.result, { total: 42, label: 'completed-fixture' });
      const persisted = await queue.getJob(job.id);
      assert.equal(await persisted.getState(), 'completed');
      assert.deepEqual(persisted.returnvalue, { total: 42, label: 'completed-fixture' });
      assert.equal(await queue.getCompletedCount(), 1);
    } finally { clearTimeout(timeout); }
  });
}

main().catch(error => {
  failed++;
  console.error(error.stack);
}).finally(async () => {
  for (const [name, close] of [
    ['worker', () => worker?.close()],
    ['queue obliterate', () => queue?.obliterate({ force: true })],
    ['queue', () => queue?.close()],
    ['worker client', () => workerClient?.quit()],
    ['queue client', () => queueClient?.quit()],
    ['redis client', () => client?.quit()],
  ]) {
    try { await close(); } catch (error) { failed++; console.error(`CLEANUP ${name}: ${error.message}`); }
  }
  if (containerId) {
    try {
      const metadata = JSON.parse(docker('inspect', containerId))[0];
      assert.equal(metadata.Config.Labels['codex.owner'], suffix);
      docker('rm', '-f', containerId);
      console.log(`CLEANUP removed owned container ${containerName}`);
    } catch (error) { failed++; console.error(`CLEANUP container: ${error.message}`); }
  }
  console.log(JSON.stringify({ passed, failed, skipped: 0 }));
  process.exitCode = failed ? 1 : 0;
});
