import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {appendFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import pg from 'pg';
import {summarizeSamples} from './measurements.mjs';

const out = 'output/notify-tx-1023';
mkdirSync(out, {recursive: true});
// Fail closed: this suite is deliberately NOT a silently skipped unit suite.
for (const key of ['INTEGRATION_DATABASE_URL_OWNER', 'INTEGRATION_DATABASE_URL_APP']) {
  const u = new URL(process.env[key] || 'invalid:');
  assert.equal(u.hostname, '127.0.0.1', key);
  assert.equal(u.pathname, '/codex_test', key);
  assert.equal(u.username, key.endsWith('OWNER') ? 'piling' : 'pilingtrack_app', key);
}
assert.match(process.env.INTEGRATION_DB_CONTAINER || '', /^codex-pg-[a-f0-9]{12}$/);
assert.equal(new URL(process.env.REDIS_URL).hostname, '127.0.0.1');
assert.equal(process.env.REDIS_URL, process.env.REDIS_URL_CACHE);
assert.equal(process.env.DATABASE_URL, process.env.INTEGRATION_DATABASE_URL_APP);
const owner = new pg.Pool({connectionString: process.env.INTEGRATION_DATABASE_URL_OWNER, max: 2});
const tenant = 'notify-b-disposable';
const children = new Set();
const timers = new Set();
const sockets = new Set();
const requests = [];
const measurements = [];
let mode = 'ok';
let responseDelay = 250;
let pendingStubResponses = 0;
let maxPendingStubResponses = 0;
let connectedStubRequests = 0;
let maxConnectedStubRequests = 0;
let base;
const server = createServer(async (req, res) => {
  assert.equal(req.url, '/botfixture-token/sendMessage');
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  const entry = {at: Date.now(), text: body.text, mode, responseAttempted: false};
  requests.push(entry); // The fake accepts before ACK: an explicit ambiguity model.
  pendingStubResponses++;
  maxPendingStubResponses = Math.max(maxPendingStubResponses, pendingStubResponses);
  connectedStubRequests++;
  maxConnectedStubRequests = Math.max(maxConnectedStubRequests, connectedStubRequests);
  res.once('close', () => { connectedStubRequests--; entry.connectionClosedAt = Date.now(); });
  if (mode === 'crash') {
    pendingStubResponses--;
    req.socket.destroy();
    return;
  }
  const timer = setTimeout(() => {
    timers.delete(timer);
    entry.responseAttempted = true;
    entry.clientDisconnected = res.destroyed;
    pendingStubResponses--;
    res.writeHead(200, {'content-type': 'application/json'});
    res.end(JSON.stringify({ok: true, result: {message_id: requests.indexOf(entry) + 1}}));
  }, responseDelay);
  timers.add(timer);
});
server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });

async function until(predicate, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (!await predicate()) {
    if (Date.now() > deadline) throw new Error('Fixture condition timed out');
    await delay(25);
  }
}
async function spawnWorker() {
  const child = fork('tests/integration/notifications/delivery-worker.cts', [], {
    execArgv: ['--import', 'tsx'], windowsHide: true,
    env: {...process.env, TELEGRAM_API_BASE: base, PGAPPNAME: 'notify-b-' + randomUUID()},
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  children.add(child);
  child.on('exit', () => children.delete(child));
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => appendFileSync(out + '/workers.log', data));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Worker startup timeout')), 15000);
    child.once('error', reject);
    child.once('exit', code => {clearTimeout(timer); reject(new Error('Worker exited before ready: ' + code));});
    child.once('message', message => {
      clearTimeout(timer);
      if (!message.ready) reject(new Error(JSON.stringify(message)));
      else resolve();
    });
  });
  return child;
}
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGKILL'); // Kill ONLY the exact child created by this suite.
  await exited;
}
function send(child, job) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Delivery timeout')), 55000);
    child.once('message', result => {
      clearTimeout(timer);
      if (result.fatal) reject(new Error(result.fatal));
      else resolve(result);
    });
    child.send(job);
  });
}
async function event(key = randomUUID()) {
  const id = randomUUID();
  const data = {severity: 'high', message: 'Disposable notification fixture', dedupeKey: 'notify-b:' + key};
  await owner.query('INSERT INTO "OutboxEvent" (id,type,"aggregateId","aggregateType",payload,"tenantId",projected) VALUES ($1,$2,$1,$3,$4::jsonb,$5,true)',
    [id, 'NotificationDeliveryRequested', 'Notification', JSON.stringify(data), tenant]);
  return {mode: 'direct', id, tenantId: tenant, data};
}
async function row(id) {
  return (await owner.query('SELECT published,payload FROM "OutboxEvent" WHERE id=$1', [id])).rows[0];
}
async function sample() {
  return (await owner.query(
    "SELECT a.pid,a.state,a.wait_event,EXTRACT(epoch FROM a.xact_start)*1000 AS xact_start_ms,EXTRACT(epoch FROM clock_timestamp())*1000 AS observed_ms,EXTRACT(epoch FROM (clock_timestamp()-a.xact_start))*1000 AS age_ms,EXISTS (SELECT 1 FROM pg_locks l WHERE l.pid=a.pid AND l.locktype='advisory' AND l.granted) AS owns_advisory FROM pg_stat_activity a WHERE application_name LIKE 'notify-b-%' AND xact_start IS NOT NULL"
  )).rows;
}
function monitor() {
  const samples = [];
  let running = true;
  const done = (async () => {
    while (running) { samples.push({at: Date.now(), rows: await sample()}); await delay(40); }
  })();
  return async () => {
    running = false;
    await done;
    return {...summarizeSamples(samples), samples};
  };
}
async function batch(same, slow = false) {
  mode = 'ok'; responseDelay = slow ? 30000 : 300; maxPendingStubResponses = 0; maxConnectedStubRequests = 0;
  const beforeCount = requests.length;
  const key = randomUUID();
  const jobs = await Promise.all([0, 1, 2].map(() => event(same ? key : randomUUID())));
  const workers = await Promise.all(jobs.map(() => spawnWorker()));
  const end = monitor();
  let results;
  try { results = await Promise.all(workers.map((w, i) => send(w, jobs[i]))); }
  finally { await Promise.all(workers.map(stop)); }
  const stats = await end();
  const calls = requests.slice(beforeCount);
  const record = {case: slow ? 'same-key-30s-response' : same ? 'same-key' : 'different-key', results,
    requestCount: calls.length, maxPendingStubResponses, maxConnectedStubRequests, ...stats};
  measurements.push(record);
  if (slow) {
    assert.equal(results.filter(r => !r.ok).length, 3);
    assert.equal(calls.length, 3);
    assert.ok(stats.maxAdvisoryWaiters >= 2);
    assert.ok(stats.maxAdvisoryHeldLowerMs >= 3500);
    assert.ok(stats.maxAdvisoryWaitLowerMs >= 7000);
    for (const job of jobs) assert.equal((await row(job.id)).published, false);
    // Let the configured 30s response actually fire, rather than cancelling it early.
    await until(() => calls.every(r => r.responseAttempted), 35000);
    record.responses = calls;
    await owner.query('UPDATE "OutboxEvent" SET published=true WHERE id=ANY($1::text[])', [jobs.map(j => j.id)]);
  } else {
    assert.ok(results.every(r => r.ok));
    assert.equal(calls.length, same ? 1 : 3);
    assert.ok(same || maxConnectedStubRequests >= 2);
    for (const job of jobs) assert.equal((await row(job.id)).published, true);
  }
}
before(async () => {
  await owner.query('INSERT INTO "Tenant" (id,slug,name,"updatedAt") VALUES ($1,$1,$1,now())', [tenant]);
  await owner.query('INSERT INTO "TelegramConfig" (id,"tenantId",label,"botToken","chatId","updatedAt") VALUES ($1,$2,$3,$4,$5,now())',
    [randomUUID(), tenant, 'Disposable only', 'fixture-token', 'fixture-chat']);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => {
  await Promise.all([...children].map(stop));
  for (const timer of timers) clearTimeout(timer);
  for (const socket of sockets) socket.destroy();
  await new Promise(resolve => server.close(resolve));
  await owner.end();
  writeFileSync(out + '/measurements.json', JSON.stringify({measurements, requests}, null, 2));
});
test('same dedupeKey: three real processes send once', {timeout: 30000}, () => batch(true));
test('different keys: requests overlap on real connections', {timeout: 30000}, () => batch(false));
test('30s HTTP response: real 5s abort, advisory queue, retained rows', {timeout: 75000}, () => batch(true, true));
test('accepted message + destroyed HTTP socket: retry may duplicate', {timeout: 30000}, async () => {
  const job = await event();
  const child = await spawnWorker();
  const start = requests.length;
  try {
    mode = 'crash';
    assert.equal((await send(child, job)).ok, false);
    assert.equal((await row(job.id)).published, false);
    mode = 'ok'; responseDelay = 100;
    assert.equal((await send(child, job)).ok, true);
    assert.equal((await row(job.id)).published, true);
    assert.equal(requests.length - start, 2);
    measurements.push({case: 'lost-ack', acceptedByStub: 2, published: true});
  } finally { await stop(child); }
});
test('kill actual polling worker after acceptance, restart: row survives, ambiguous send repeats', {timeout: 35000}, async () => {
  const job = await event();
  const start = requests.length;
  let child = await spawnWorker();
  try {
    mode = 'ok'; responseDelay = 30000;
    assert.equal((await send(child, {mode: 'poll', tenantId: tenant})).started, true);
    await until(() => requests.length > start);
    await stop(child);
    assert.equal((await row(job.id)).published, false);
    assert.equal((await row(job.id)).payload.telegramAlertSent, undefined);
    responseDelay = 100;
    child = await spawnWorker();
    assert.equal((await send(child, {mode: 'poll', tenantId: tenant})).started, true);
    await until(async () => (await row(job.id)).published);
    assert.equal(requests.length - start, 2);
    measurements.push({case: 'polling-worker-restart', acceptedByStub: 2, published: true,
      workerEntry: 'startOutboxWorker (existing implementation); daemon leader election not exercised'});
  } finally { await stop(child); }
});
test('acknowledged row replay: new process does not send again', {timeout: 30000}, async () => {
  mode = 'ok'; responseDelay = 100;
  const job = await event();
  const start = requests.length;
  let child = await spawnWorker();
  try {
    assert.equal((await send(child, job)).ok, true);
    await stop(child);
    child = await spawnWorker();
    assert.equal((await send(child, job)).ok, true);
    assert.equal(requests.length - start, 1);
    measurements.push({case: 'published-replay', acceptedByStub: 1, published: true});
  } finally { await stop(child); }
});
