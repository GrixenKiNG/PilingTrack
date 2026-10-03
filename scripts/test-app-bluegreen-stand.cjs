// Real Next/worker images, Caddy reload, disposable PG + two Redis instances.
// The streaming fixture wraps Next only on this stand; normal URLs reach Next.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const net = require('node:net');
const http = require('node:http');
const assert = require('node:assert/strict');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const suffix = crypto.randomBytes(6).toString('hex');
const project = 'codex-bluegreen-' + suffix;
const network = project + '-net';
const dir = path.resolve('output/codex-t7/bluegreen-' + suffix);
const label = 'pilingtrack.codex.bluegreen=' + suffix;
const appImage = process.env.CODEX_BLUEGREEN_APP_IMAGE || 'codex-app-t7:g2';
const oldImage = process.env.CODEX_BLUEGREEN_OLD_IMAGE || 'codex-app-t7:g2-old';
const workerImage = process.env.CODEX_BLUEGREEN_WORKER_IMAGE || 'codex-workers-t7:g2';
const newSha = process.env.CODEX_BLUEGREEN_NEW_SHA || '41fe41dc';
const oldSha = process.env.CODEX_BLUEGREEN_OLD_SHA || '2c1c34cf';
const legacy = process.env.CODEX_BLUEGREEN_LEGACY === 'true';
const oldName = project + (legacy ? '-app-legacy' : '-app-blue');
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const env = { ...process.env };
delete env.MSYS_NO_PATHCONV;
const secrets = [];
const result = { requests: 0, fiveXX: 0, requestExceptions: 0, bodyErrors: 0,
  leaderSamples: 0, doubleLeaders: 0, peakTotalMiB: 0, peakMiB: {}, scenarios: [],
  mode: legacy ? 'legacy embedded app to dedicated workers' : 'disabled HTTP slots',
  storage: 'empty test tmpfs; no business file writes; image fixture PDFs stay untouched' };
let monitoring = false;
let loadPromise;
let samplePromise;
function redact(value) {
  let text = String(value);
  for (const secret of secrets) text = text.split(secret).join('[redacted]');
  return text;
}
function docker(args, options = {}) {
  try {
    return cp.execFileSync('docker', args, { env, windowsHide: true, encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'], ...options }).trim();
  } catch (error) {
    throw new Error(redact(error.stderr || error.message));
  }
}
function run(exe, args, extra = {}, onOutput = () => {}) {
  return new Promise((resolve, reject) => {
    const child = cp.spawn(exe, args, { env: { ...env, ...extra }, windowsHide: true });
    let output = '';
    child.stdout.on('data', data => { const text = redact(data); output += text; onOutput(text); });
    child.stderr.on('data', data => { output += redact(data); });
    child.on('error', reject);
    child.on('close', code => resolve({ code, output }));
  });
}
async function monitoredDocker(args) {
  const completed = await run('docker', args);
  if (completed.code !== 0) {
    if (/No such (container|object)/i.test(completed.output)) {
      result.containerTransitions = (result.containerTransitions || 0) + 1;
      return '';
    }
    throw new Error(completed.output);
  }
  return completed.output.trim();
}
async function port() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const value = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return value;
}
async function health(url, sha, attempts = 90) {
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(url + '/api/health', { signal: AbortSignal.timeout(5000) });
      if (response.ok && (await response.json()).version === sha) return;
    } catch { /* Startup is bounded; the load phase starts only after ready. */ }
    await sleep(1000);
  }
  throw new Error('Health/SHA not ready: ' + url);
}
function writeAppCompose(failing = false) {
  fs.writeFileSync(dir + '/app.yml', `services:
  app:
    image: \${APP_IMAGE}
    container_name: \${APP_CONTAINER_NAME}
    restart: "no"
    labels: { pilingtrack.codex.bluegreen: "${suffix}" }
    ports: ["127.0.0.1:\${APP_HOST_PORT}:3000"]
    mem_limit: 1g
    cpus: 1.0
    environment:
      DATABASE_PROVIDER: postgres
      DATABASE_URL_POSTGRES: \${DATABASE_URL_POSTGRES}
      DB_IDENTITY_ROLE: pilingtrack_identity
      REDIS_URL: redis://state:6379
      REDIS_URL_CACHE: redis://cache:6379
      SESSION_SECRET: \${SESSION_SECRET}
      DEVICE_KEY_LOOKUP_SECRET: \${DEVICE_KEY_LOOKUP_SECRET}
      PIN_LOOKUP_SECRET: \${PIN_LOOKUP_SECRET}
      ENCRYPTION_KEY: \${ENCRYPTION_KEY}
      EMBEDDED_WORKERS: disabled
      NODE_OPTIONS: --max-old-space-size=512
      LOG_LEADER_ELECTION: "true"
      TRUST_PROXY: "true"
      HOSTNAME: 0.0.0.0
    command: ${failing ? '[node, -e, "process.exit(7)"]' : '[node, /codex-fixtures/app-wrapper.cjs]'}
    volumes: ["${dir.replaceAll('\\', '/') }:/codex-fixtures:ro"]
    tmpfs: ["/app/storage:rw,size=64m,mode=1777"]
    healthcheck:
      test: [CMD, wget, -q, --spider, http://127.0.0.1:3000/api/health]
      interval: 2s
      timeout: 5s
      start_period: 2s
      retries: 2
    networks: [stand]
networks:
  stand: { external: true, name: "${network}" }
`);
}
async function load(baseURL, paths) {
  while (monitoring) {
    await Promise.all(paths.map(async pathname => {
      try {
        const response = await fetch(baseURL + pathname, { signal: AbortSignal.timeout(10000) });
        const body = await response.text();
        result.requests++;
        if (response.status >= 500) result.fiveXX++;
        if (response.status !== 200 || !body.length) result.bodyErrors++;
        if (pathname === '/api/health') {
          const healthBody = JSON.parse(body);
          if (![oldSha, newSha].includes(healthBody.version)) result.bodyErrors++;
        }
      } catch { result.requestExceptions++; }
    }));
    await sleep(25);
  }
}
function memoryMiB(text) {
  const match = /^([\d.]+)([KMGT]?i?B)/.exec(text);
  if (!match) throw new Error('Unknown docker memory unit: ' + text);
  const units = { B: 1 / 1048576, KiB: 1 / 1024, MiB: 1, GiB: 1024,
    kB: 1 / 1048.576, MB: 1 / 1.048576, GB: 953.67431640625 };
  return Number(match[1]) * units[match[2]];
}
async function sample(workerURL) {
  while (monitoring) {
    const live = (await monitoredDocker(['ps', '-q', '--filter', 'label=' + label])).split('\n').filter(Boolean);
    const rows = await monitoredDocker(['stats', '--no-stream', '--format', '{{.Name}}|{{.MemUsage}}',
      process.env.INTEGRATION_DB_CONTAINER, ...live]);
    let total = 0;
    for (const line of rows.split('\n')) {
      const [name, memory] = line.split('|');
      if (!name || !memory) continue;
      const amount = memoryMiB(memory);
      total += amount;
      result.peakMiB[name] = Math.max(result.peakMiB[name] || 0, amount);
    }
    result.peakTotalMiB = Math.max(result.peakTotalMiB, total);
    const appIds = (await monitoredDocker(['ps', '-q', '--filter', 'label=' + label,
      '--filter', 'label=com.docker.compose.service=app'])).split('\n').filter(Boolean);
    for (const id of appIds) {
      const settings = await monitoredDocker(['inspect', '-f', '{{range .Config.Env}}{{println .}}{{end}}', id]);
      if (!settings) continue; // An observed old container may be retired between Docker calls.
      const disabled = settings.split('\n').includes('EMBEDDED_WORKERS=disabled');
      const name = await monitoredDocker(['inspect', '-f', '{{.Name}}', id]);
      if (!disabled && !(legacy && name === '/' + oldName)) result.doubleLeaders++;
    }
    // Exactly one dedicated process exists; health and Redis owner must agree.
    const workers = (await monitoredDocker(['ps', '-q', '--filter', 'label=' + label,
      '--filter', 'label=com.docker.compose.service=workers'])).split('\n').filter(Boolean);
    if (workers.length > 1) result.doubleLeaders++;
    if (legacy) await sampleLegacy([...appIds, ...workers]);
    if (workers.length === 1) {
      try {
        const response = await fetch(workerURL + '/health', { signal: AbortSignal.timeout(3000) });
        const body = await response.json();
        if (response.ok && body.workers.outbox.leader && body.workers.projection.leader) {
          result.leaderSamples++;
          for (const resource of ['outbox-worker', 'projection-worker']) {
            const owner = await monitoredDocker(['exec', project + '-state', 'redis-cli', 'GET', 'pilingtrack:leader:' + resource]);
            const hostname = await monitoredDocker(['inspect', '-f', '{{.Config.Hostname}}', workers[0]]);
            const running = await monitoredDocker(['inspect', '-f', '{{.State.Running}}', workers[0]]);
            if (running === 'true' && owner) assert.ok(owner.startsWith(hostname + '-'), 'Owner differs from actual worker hostname: ' + owner);
          }
        }
      } catch (error) {
        // F1 intentionally removes the worker health port while replacing it.
        if (error.code === 'ERR_ASSERTION') throw error;
      }
    }
    await sleep(1000);
  }
}
async function sampleLegacy(ids) {
  const claims = new Map();
  for (const id of ids) {
    const records = (await monitoredDocker(['logs', id])).split('\n');
    const states = new Map();
    for (const line of records) {
      let event; try { event = JSON.parse(line); } catch { continue; }
      if (!event.resource || !event.nodeId) continue;
      if (event.message === 'Leader election started') states.set(event.resource, { owner: event.nodeId, leader: false });
      if (event.message === 'Leader election: became leader') states.set(event.resource, { owner: event.nodeId, leader: true });
      if (['Leader election: lost leadership', 'Leader election stopped'].includes(event.message)) states.set(event.resource, { owner: event.nodeId, leader: false });
    }
    const running = await monitoredDocker(['inspect', '-f', '{{.State.Running}}', id]);
    if (running !== 'true') continue;
    const hostname = await monitoredDocker(['inspect', '-f', '{{.Config.Hostname}}', id]);
    if (!hostname) continue;
    for (const [resource, state] of states) {
      assert.ok(state.owner.startsWith(hostname + '-'), 'Log nodeId differs from real container hostname');
      if (state.leader) claims.set(resource, [...(claims.get(resource) || []), { id, owner: state.owner }]);
    }
  }
  for (const [resource, leaders] of claims) {
    if (leaders.length > 1) result.doubleLeaders++;
    const owner = await monitoredDocker(['exec', project + '-state', 'redis-cli', 'GET', 'pilingtrack:' + resource]);
    if (leaders.length === 1 && owner === leaders[0].owner) {
      result.logOwnerSamples = (result.logOwnerSamples || 0) + 1;
      const name = await monitoredDocker(['inspect', '-f', '{{.Name}}', leaders[0].id]);
      if (name === '/' + oldName) result.embeddedLeaderSamples = (result.embeddedLeaderSamples || 0) + 1;
    }
  }
}
function streamedRequest(url) {
  const startedAt = Date.now();
  let started;
  const first = new Promise(resolve => { started = resolve; });
  const complete = new Promise((resolve, reject) => {
    let chunks = 0;
    let bytes = 0;
    const request = http.get(url, response => {
      if (response.statusCode !== 200) {
        response.resume(); reject(new Error('Drain fixture HTTP ' + response.statusCode)); return;
      }
      response.on('data', data => { chunks++; bytes += data.length; started(); });
      response.on('error', reject);
      response.on('end', () => resolve({ bytes, chunks, startedAt, completedAt: Date.now() }));
    });
    request.on('error', reject);
    request.setTimeout(150000, () => request.destroy(new Error('Drain fixture timed out')));
  });
  return { first, complete };
}
(async () => {
  fs.mkdirSync(dir, { recursive: true });
  if (process.platform === 'win32') {
    // Docker must keep Linux container paths; native curl still needs /dev/null conversion.
    fs.writeFileSync(dir + '/bash-env', 'docker() { MSYS_NO_PATHCONV=1 command docker "$@"; }\n');
    env.BASH_ENV = dir.replaceAll('\\', '/') + '/bash-env';
  }
  assert.match(process.env.INTEGRATION_DB_CONTAINER || '', /^codex-pg-[a-f0-9]{12}$/);
  for (const image of [appImage, oldImage, workerImage]) {
    assert.ok(image.startsWith('codex-'), 'Images must be codex-only');
    docker(['image', 'inspect', image]);
  }
  const dbURL = new URL(process.env.INTEGRATION_DATABASE_URL_APP);
  dbURL.hostname = 'pg'; dbURL.port = '5432';
  env.DATABASE_URL_POSTGRES = dbURL.href;
  for (const key of ['SESSION_SECRET', 'DEVICE_KEY_LOOKUP_SECRET', 'PIN_LOOKUP_SECRET', 'ENCRYPTION_KEY']) {
    env[key] = crypto.randomBytes(32).toString('hex'); secrets.push(env[key]);
  }
  secrets.push(process.env.INTEGRATION_DATABASE_URL_OWNER, process.env.INTEGRATION_DATABASE_URL_APP,
    env.DATABASE_URL_POSTGRES, dbURL.password);
  docker(['network', 'create', '--label', label, network]);
  try {
    docker(['network', 'connect', '--alias', 'pg', network, process.env.INTEGRATION_DB_CONTAINER]);
    docker(['update', '--memory', '1g', '--memory-swap', '1g', '--cpus', '1', process.env.INTEGRATION_DB_CONTAINER]);
    const appRole = docker(['exec', process.env.INTEGRATION_DB_CONTAINER, 'psql', '-U', 'piling',
      '-d', 'codex_test', '-Atc', "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname='pilingtrack_app'"]);
    assert.equal(appRole, 'f|f');
    result.appRole = { superuser: false, bypassRLS: false };
    for (const kind of ['state', 'cache']) {
      const name = project + '-' + kind;
      docker(['run', '-d', '--name', name, '--label', label, '--network', network,
        '--network-alias', kind, '--memory', '256m', '--memory-swap', '256m', '--cpus', '0.5',
        'redis:7-alpine', 'redis-server', '--maxmemory', '128mb', '--maxmemory-policy',
        kind === 'state' ? 'noeviction' : 'allkeys-lru']);
    }
    const bluePort = await port(); const greenPort = await port(); const workerPort = await port();
    fs.writeFileSync(dir + '/app-wrapper.cjs', `const cp=require('node:child_process'),http=require('node:http'),fs=require('node:fs');
if(process.env.CODEX_OLD_STATIC_PROOF==='true'){fs.mkdirSync('/app/.next/static/chunks',{recursive:true});fs.writeFileSync('/app/.next/static/chunks/codex-old-build-proof.js','/* codex old generation static proof */\\n');}
const child=cp.spawn(process.execPath,['server.js'],{cwd:'/app',env:{...process.env,PORT:'3003'},stdio:'inherit'});
const server=http.createServer((q,r)=>{if(q.url==='/__codex_drain'){r.writeHead(200,{'content-type':'application/octet-stream'});let n=0;const timer=setInterval(()=>{r.write(Buffer.alloc(40960,90));if(++n===180){clearInterval(timer);r.end();}},500);r.on('close',()=>clearInterval(timer));return;}
const proxy=http.request({host:'127.0.0.1',port:3003,path:q.url,method:q.method,headers:q.headers},p=>{r.writeHead(p.statusCode,p.headers);p.pipe(r);});proxy.on('error',()=>{r.writeHead(502);r.end('Next not ready');});q.pipe(proxy);});
server.listen(3000,'0.0.0.0');process.on('SIGTERM',()=>{server.close(()=>{child.kill('SIGTERM');setTimeout(()=>process.exit(143),500);});setTimeout(()=>process.exit(1),115000).unref();});
child.on('exit',code=>{if(code)process.exit(code);});
`);
    writeAppCompose();
    let baseApp = `  app:
    image: ${oldImage}
    profiles: [legacy]
    networks: [stand]
`;
    if (legacy) {
      const content = fs.readFileSync(dir + '/app.yml', 'utf8').replace('EMBEDDED_WORKERS: disabled', 'EMBEDDED_WORKERS: default\n      CODEX_OLD_STATIC_PROOF: "true"');
      fs.writeFileSync(dir + '/legacy-app.yml', content);
      baseApp = content.split('\nnetworks:')[0].replace(/^services:\n/, '');
    }
    fs.writeFileSync(dir + '/workers.yml', `services:
${baseApp}
  workers:
    image: ${workerImage}
    container_name: ${project}-workers
    hostname: ${project}-workers
    restart: "no"
    labels: { pilingtrack.codex.bluegreen: "${suffix}" }
    ports: ["127.0.0.1:${workerPort}:3002"]
    mem_limit: 512m
    cpus: 0.75
    tmpfs: ["/app/storage:rw,size=64m,mode=1777"]
    environment:
      DATABASE_PROVIDER: postgres
      DATABASE_URL_POSTGRES: \${DATABASE_URL_POSTGRES}
      DB_IDENTITY_ROLE: pilingtrack_identity
      REDIS_URL: redis://state:6379
      REDIS_URL_CACHE: redis://cache:6379
      ENCRYPTION_KEY: \${ENCRYPTION_KEY}
      ENABLED_WORKERS: outbox,projection
      LOG_LEADER_ELECTION: "true"
      WORKER_SHUTDOWN_TIMEOUT_MS: "8000"
      OUTBOX_INTERVAL_MS: "2000"
      PROJECTION_INTERVAL_MS: "2000"
      PM_SCHEDULER_ENABLED: "false"
      PROJECTION_REBUILD_ENABLED: "false"
      READINESS_SCHEDULER_ENABLED: "false"
    healthcheck:
      test: [CMD, curl, -f, http://127.0.0.1:3002/health]
      interval: 2s
      timeout: 5s
      start_period: 40s
      retries: 3
    networks: [stand]
networks:
  stand: { external: true, name: "${network}" }
`);
    Object.assign(env, { COMPOSE_FILE: dir + '/workers.yml', WORKER_GENERATION_PROJECT: project,
      WORKER_GENERATION_EXTERNAL_STOPPED: '1', BLUEGREEN_APP_COMPOSE_FILES: dir + '/app.yml',
      BLUEGREEN_APP_NETWORK: network, BLUEGREEN_BLUE_PORT: String(bluePort), BLUEGREEN_GREEN_PORT: String(greenPort),
      BLUEGREEN_PROXY_HOST: 'host.docker.internal', BLUEGREEN_CADDY_CONTAINER: project + '-caddy',
      BLUEGREEN_CADDY_SOURCE: dir + '/Caddyfile', BLUEGREEN_CADDY_CONFIG: '/etc/caddy/Caddyfile',
      BLUEGREEN_CADDY_SNIPPET: dir + '/app-upstream.caddy', BLUEGREEN_DRAIN_SECONDS: '5',
      BLUEGREEN_TIMEOUT_SECONDS: '30', WORKER_GENERATION_STOP_TIMEOUT_SECONDS: '120',
      BLUEGREEN_LOCK: dir + '/lock' });
    env.APP_IMAGE = oldImage; env.APP_CONTAINER_NAME = oldName; env.APP_HOST_PORT = String(bluePort);
    docker(['compose', '-f', dir + (legacy ? '/legacy-app.yml' : '/app.yml'), '-p',
      project + (legacy ? '' : '-blue'), 'up', '-d', '--no-build', 'app']);
    await health('http://127.0.0.1:' + bluePort, oldSha);
    docker(['compose', '-p', project, 'up', '-d', '--no-build', 'workers']);
    await health('http://127.0.0.1:' + bluePort, oldSha);
    // A genuinely old-only Next static URL proves compatibility after old retirement.
    if (!legacy) {
      docker(['exec', '-u', '0', '-i', oldName, 'sh', '-c',
      'mkdir -p /app/.next/static/chunks; cat > /app/.next/static/chunks/codex-old-build-proof.js'],
      { input: '/* codex old generation static proof */\n' });
      docker(['restart', '--time', '30', oldName]);
      await health('http://127.0.0.1:' + bluePort, oldSha);
    }
    fs.writeFileSync(dir + '/Caddyfile', ':8080 {\n  import app-upstream.caddy\n}\n');
    fs.writeFileSync(dir + '/app-upstream.caddy', 'reverse_proxy host.docker.internal:' + bluePort + '\n');
    try { docker(['image', 'inspect', 'codex-caddy-t7:g2']); }
    catch {
      fs.writeFileSync(dir + '/Dockerfile.caddy', 'FROM caddy:2-alpine\n');
      docker(['build', '-f', dir + '/Dockerfile.caddy', '-t', 'codex-caddy-t7:g2', dir]);
    }
    docker(['run', '-d', '--name', project + '-caddy', '--label', label, '--network', network,
      '--memory', '128m', '--memory-swap', '128m', '-p', '127.0.0.1::8080',
      '--mount', 'type=bind,source=' + dir + ',target=/etc/caddy', 'codex-caddy-t7:g2']);
    const caddyPort = docker(['port', project + '-caddy', '8080/tcp']).split(':').pop();
    env.BLUEGREEN_PUBLIC_URL = 'http://127.0.0.1:' + caddyPort;
    await health(env.BLUEGREEN_PUBLIC_URL, oldSha);
    const oldHTML = await (await fetch(env.BLUEGREEN_PUBLIC_URL + '/login')).text();
    const oldAssets = [...new Set(oldHTML.match(/\/_next\/static\/[^"\s<>]+\.js/g) || [])];
    assert.ok(oldAssets.length, 'Actual old HTML must contain Next chunk URLs');
    const proofPath = '/_next/static/chunks/codex-old-build-proof.js';
    assert.equal((await fetch(env.BLUEGREEN_PUBLIC_URL + proofPath)).status, 200);
    monitoring = true;
    loadPromise = load(env.BLUEGREEN_PUBLIC_URL, ['/api/health', '/login', proofPath, ...oldAssets]);
    samplePromise = sample('http://127.0.0.1:' + workerPort).catch(error => {
      result.monitorError = redact(error.message); monitoring = false;
    });
    writeAppCompose(true);
    const failed = await run(bash, ['scripts/replace-app-bluegreen.sh', appImage, newSha], { BLUEGREEN_TIMEOUT_SECONDS: '5' });
    fs.writeFileSync(dir + '/candidate-failure.log', failed.output);
    assert.notEqual(failed.code, 0, 'Crashing candidate accepted');
    await health(env.BLUEGREEN_PUBLIC_URL, oldSha, 1);
    result.scenarios.push('crashing new app preserves old SHA');
    writeAppCompose();
    result.previousWorker = await monitoredDocker(['ps', '-q', '--filter', 'label=' + label,
      '--filter', 'label=com.docker.compose.service=workers']);
    result.previousOwners = {};
    for (const resource of ['outbox-worker', 'projection-worker']) {
      result.previousOwners[resource] = await monitoredDocker(['exec', project + '-state', 'redis-cli', 'GET',
        'pilingtrack:leader:' + resource]);
      assert.ok(result.previousOwners[resource]);
    }
    const stream = streamedRequest(env.BLUEGREEN_PUBLIC_URL + '/__codex_drain');
    stream.complete.catch(() => {}); // Keep cleanup reachable if the helper fails first.
    await stream.first;
    const switched = await run(bash, ['scripts/replace-app-bluegreen.sh', appImage, newSha], {}, text => {
      if (text.includes('SWITCH:')) result.switchedAt = Date.now();
    });
    fs.writeFileSync(dir + '/switch.log', switched.output);
    assert.equal(switched.code, 0, switched.output);
    if (legacy) {
      const running = await monitoredDocker(['ps', '-q', '--filter',
        'label=com.docker.compose.project=' + project, '--filter', 'label=com.docker.compose.service=app']);
      assert.equal(running, '', 'F1 restarted a legacy embedded app while selecting only workers');
      result.legacyAppsRunningAfterF1 = 0;
    }
    await health(env.BLUEGREEN_PUBLIC_URL, newSha, 1);
    const staticStatus = (await fetch(env.BLUEGREEN_PUBLIC_URL + proofPath)).status;
    result.oldStaticStatus = staticStatus;
    assert.equal(staticStatus, 200, 'Old-only Next static URL lost after old app retirement');
    result.scenarios.push('old HTML chunks and old-only asset remain available');
    const drained = await stream.complete;
    assert.equal(drained.bytes, 180 * 40960, 'In-flight response bytes lost');
    assert.ok(drained.chunks >= 2, 'Streaming fixture did not stream');
    assert.ok(drained.startedAt < result.switchedAt && drained.completedAt > result.switchedAt,
      'Long response did not overlap the actual Caddy cutover');
    result.drain = drained;
    result.scenarios.push('real Caddy cutover and complete in-flight stream');

    if (legacy) {
      let elected = false;
      for (let i = 0; i < 60; i++) {
        try {
          const response = await fetch('http://127.0.0.1:' + workerPort + '/health');
          const state = await response.json();
          if (state.workers.outbox.leader && state.workers.projection.leader) { elected = true; break; }
        } catch { /* A previous embedded owner's TTL can expire before takeover. */ }
        await sleep(1000);
      }
      assert.ok(elected, 'Dedicated worker takeover did not finish after legacy shutdown');
    }
    await sleep(12000); // Cross a real 10-second lease renewal interval.
    result.currentWorker = await monitoredDocker(['ps', '-q', '--filter', 'label=' + label,
      '--filter', 'label=com.docker.compose.service=workers']);
    assert.notEqual(result.currentWorker, result.previousWorker, 'F1 did not replace the actual worker');
    result.currentOwners = {};
    for (const resource of ['outbox-worker', 'projection-worker']) {
      result.currentOwners[resource] = await monitoredDocker(['exec', project + '-state', 'redis-cli', 'GET',
        'pilingtrack:leader:' + resource]);
      assert.notEqual(result.currentOwners[resource], result.previousOwners[resource], 'Owner did not change');
    }
    monitoring = false;
    await Promise.all([loadPromise, samplePromise]);
    assert.equal(result.fiveXX, 0); assert.equal(result.requestExceptions, 0);
    assert.equal(result.bodyErrors, 0); assert.equal(result.doubleLeaders, 0);
    assert.equal(result.monitorError, undefined);
    assert.ok(result.leaderSamples >= 2, 'No live worker owner evidence');
    if (legacy) {
      assert.ok(result.embeddedLeaderSamples >= 2, 'Legacy embedded processes were never observed as real leaders');
      assert.ok(/старых реплик 2/.test(switched.output), 'F1 did not cover both legacy app and workers');
      result.scenarios.push('F1 stops legacy embedded app and dedicated workers before new worker START');
    }
    result.exit = 0;
    console.log(JSON.stringify(result, null, 2));
  } finally {
    monitoring = false;
    await Promise.allSettled([loadPromise, samplePromise]);
    fs.writeFileSync(dir + '/result.json', JSON.stringify(result, null, 2));
    const own = docker(['ps', '-aq', '--filter', 'label=' + label]).split('\n').filter(Boolean);
    for (const id of own) {
      const name = docker(['inspect', '-f', '{{.Name}}', id]).replace(/^\//, '');
      try {
        const logs = cp.execFileSync('docker', ['logs', id], { env, encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        fs.writeFileSync(dir + '/' + name + '.log', redact(logs));
      } catch { /* Failure details remain in the helper log. */ }
      const status = docker(['inspect', '-f', '{{json .State.Health}}', id]);
      fs.writeFileSync(dir + '/' + name + '-health.json', redact(status));
    }
    for (const id of own) docker(['rm', '-fv', id]);
    docker(['network', 'disconnect', network, process.env.INTEGRATION_DB_CONTAINER]);
    docker(['network', 'rm', network]);
    console.log('Owned stand cleanup done: ' + dir);
  }
})().catch(error => { console.error(redact(error.stack)); process.exitCode = 1; });
