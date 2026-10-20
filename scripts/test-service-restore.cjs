// Run through test-day-stand.cjs after its E2E command. Only owned local fixtures.
// Credentials and private TLS keys stay in memory; no .env files are loaded.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
const zlib = require('node:zlib');
const {Client} = require('pg');
const {S3Client, CreateBucketCommand, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand, DeleteBucketCommand} = require('@aws-sdk/client-s3');

const suffix = crypto.randomBytes(6).toString('hex');
const prefix = `codex-recovery-${suffix}`;
const dir = path.resolve('output/acceptance-1018', prefix);
const names = [];
const children = [];
const clients = [];
const assets = [];
const backupKeys = [];
const storedObjects = [];
let owner, source, proxy, backupBucket;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const digest = body => crypto.createHash('sha256').update(body).digest('hex');
const sensitive = Object.entries(process.env).filter(([key]) => /PASSWORD|SECRET|DATABASE_URL/.test(key)).map(([, value]) => value).filter(Boolean);
const redact = value => sensitive.reduce((text, secret) => text.split(secret).join('[redacted]'), String(value));
const docker = (args, extra = {}) => cp.execFileSync('docker', args, {encoding: 'utf8', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], ...extra}).trim();
function assert(condition, message) { if (!condition) throw Error(message); }
async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
function startContainer(kind, image, args = [], variables = {}, command = []) {
  const name = kind === 'pg' ? `codex-pg-${suffix}` : `${prefix}-${kind}`;
  const env = {...process.env, ...variables};
  for (const [key, value] of Object.entries(variables)) if (/PASSWORD|SECRET/.test(key)) sensitive.push(value);
  docker(['run', '-d', '--name', name, '--label', 'pilingtrack.codex.service-restore=1', ...(kind === 'pg' ? ['--label', 'pilingtrack.codex.test-db=1'] : []), ...Object.keys(variables).flatMap(key => ['-e', key]), ...args, image, ...command], {env});
  names.push(name);
  return name;
}
function mappedPort(name, port) { return Number(docker(['port', name, `${port}/tcp`]).split(':').pop()); }
async function api(base, resource, cookie, data) {
  const response = await fetch(base + resource, {method: data ? 'POST' : 'GET', headers: {Cookie: cookie || '', Origin: base, 'Content-Type': 'application/json'}, ...(data ? {body: JSON.stringify(data)} : {}), signal: AbortSignal.timeout(30_000)});
  assert(response.ok, `${resource.split('?')[0]} returned ${response.status}`);
  return response;
}
async function login(base) {
  const response = await api(base, '/api/auth/login', '', {email: process.env.E2E_ADMIN_EMAIL, password: process.env.E2E_ADMIN_PASSWORD});
  const cookie = response.headers.getSetCookie().find(value => value.startsWith('pt-session='))?.split(';')[0];
  assert(cookie, 'Session cookie missing');
  return cookie;
}
async function getObject(client, Bucket, Key) {
  const result = await client.send(new GetObjectCommand({Bucket, Key}));
  return Buffer.from(await result.Body.transformToByteArray());
}
function httpsBytes(url, ca) {
  return new Promise((resolve, reject) => {
    https.get(url, {ca, timeout: 30_000}, response => {
      if (response.statusCode !== 200) { response.resume(); reject(Error(`Restored object returned ${response.statusCode}`)); return; }
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    }).on('error', reject).on('timeout', function () { this.destroy(Error('Restored object timeout')); });
  });
}

(async () => {
  const dbUrl = new URL(process.env.INTEGRATION_DATABASE_URL_OWNER || 'http://invalid');
  const base = new URL(process.env.BASE_URL || 'http://invalid');
  const endpoint = new URL(process.env.S3_ENDPOINT || 'http://invalid');
  assert(dbUrl.hostname === '127.0.0.1' && dbUrl.pathname === '/codex_test' && dbUrl.username === 'piling', 'Only disposable local database');
  assert(base.hostname === '127.0.0.1' && endpoint.hostname === '127.0.0.1' && process.env.S3_BUCKET === 'codex-photos', 'Only disposable local application/S3');
  const sourceContainer = process.env.INTEGRATION_DB_CONTAINER;
  assert(/^codex-pg-[a-f0-9]{12}$/.test(sourceContainer || ''), 'Owned source container required');
  assert(docker(['inspect', '-f', '{{index .Config.Labels "pilingtrack.codex.test-db"}}', sourceContainer]) === '1', 'Source container label mismatch');
  assert(Number(dbUrl.port) === mappedPort(sourceContainer, 5432), 'Database URL does not match owned source container');
  assert(process.env.E2E_ADMIN_EMAIL?.endsWith('@example.invalid'), 'Disposable account required');
  fs.mkdirSync(dir, {recursive: true});
  owner = new Client({connectionString: dbUrl.toString()});
  await owner.connect();
  const sourceCookie = await login(base.origin);
  const sessionUser = (await api(base.origin, '/api/auth/me', sourceCookie).then(result => result.json())).user;
  const user = (await owner.query('SELECT id,"tenantId" FROM "User" WHERE id=$1', [sessionUser.id])).rows[0];
  assert(user?.tenantId, 'Disposable account organization missing');
  const report = (await owner.query('SELECT "reportId",date,"siteId" FROM "Report" WHERE "tenantId"=$1 AND status=$2 ORDER BY "createdAt" DESC LIMIT 1', [user.tenantId, 'submitted'])).rows[0];
  assert(report, 'A submitted report from E2E is required');
  const queued = await api(base.origin, '/api/reports/single-pdf', sourceCookie, {reportId: report.reportId}).then(result => result.json());
  let completed = false;
  for (let n = 0; n < 60; n++) {
    const status = await api(base.origin, `/api/reports/single-pdf?jobId=${queued.jobId}&action=status`, sourceCookie).then(result => result.json());
    if (status.status === 'completed') { completed = true; break; }
    assert(status.status !== 'failed', 'Source PDF generation failed');
    await sleep(1000);
  }
  assert(completed, 'Source PDF did not complete');
  const pdf = Buffer.from(await api(base.origin, `/api/reports/single-pdf?jobId=${queued.jobId}&action=download`, sourceCookie).then(result => result.arrayBuffer()));
  assert(pdf.subarray(0, 5).toString() === '%PDF-', 'Source document is not PDF');
  const png = await require('sharp')({create: {width: 8, height: 8, channels: 3, background: '#386078'}}).png().toBuffer();
  source = new S3Client({endpoint: endpoint.origin, region: process.env.S3_REGION, forcePathStyle: true, credentials: {accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY}});
  clients.push(source);
  for (const [name, body, type] of [['photo.png', png, 'image/png'], ['report.pdf', pdf, 'application/pdf']]) {
    const id = `${prefix}-${name}`, key = `${prefix}/${name}`;
    await source.send(new PutObjectCommand({Bucket: process.env.S3_BUCKET, Key: key, Body: body, ContentType: type}));
    assets.push({id, key, body, type});
    await owner.query('INSERT INTO "Media" (id,"tenantId","userId","entityType","entityId","fileName","contentType","fileSize",key,"uploadStatus","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())', [id, user.tenantId, user.id, 'report', report.reportId, name, type, body.length, key, 'completed']);
  }
  const dumpPath = path.join(dir, 'snapshot.sql.gz');
  cp.execFileSync(process.execPath, ['scripts/test-db-dump.cjs', sourceContainer, dumpPath], {windowsHide: true, stdio: 'pipe'});
  const manifest = JSON.parse(fs.readFileSync(dumpPath + '.manifest.json', 'utf8'));
  backupBucket = `${prefix}-backup`;
  await source.send(new CreateBucketCommand({Bucket: backupBucket}));
  let continuation;
  do {
    const page = await source.send(new ListObjectsV2Command({Bucket: process.env.S3_BUCKET, ContinuationToken: continuation}));
    for (const object of page.Contents || []) {
      const result = await source.send(new GetObjectCommand({Bucket: process.env.S3_BUCKET, Key: object.Key}));
      storedObjects.push({key: object.Key, body: Buffer.from(await result.Body.transformToByteArray()), type: result.ContentType});
    }
    continuation = page.NextContinuationToken;
  } while (continuation);
  const completedMedia = await owner.query('SELECT key FROM "Media" WHERE "isDeleted"=false AND "uploadStatus"=$1', ['completed']);
  for (const media of completedMedia.rows) assert(storedObjects.some(object => object.key === media.key), 'Completed media object missing from source bucket');
  for (const [key, body] of [['db.sql.gz', fs.readFileSync(dumpPath)], ['manifest.json', fs.readFileSync(dumpPath + '.manifest.json')], ...storedObjects.map(object => ['objects/' + object.key, object.body])]) {
    await source.send(new PutObjectCommand({Bucket: backupBucket, Key: key, Body: body}));
    backupKeys.push(key);
  }
  // Measured recovery starts with retrieval, after the backup already exists.
  const started = Date.now();
  const dump = await getObject(source, backupBucket, 'db.sql.gz');
  assert(digest(dump) === digest(fs.readFileSync(dumpPath)), 'Backup dump digest mismatch');
  const savedManifest = await getObject(source, backupBucket, 'manifest.json');
  assert(digest(savedManifest) === digest(fs.readFileSync(dumpPath + '.manifest.json')), 'Backup manifest digest mismatch');
  const downloadedDump = path.join(dir, 'downloaded.sql.gz');
  fs.writeFileSync(downloadedDump, dump);
  fs.writeFileSync(downloadedDump + '.manifest.json', savedManifest);
  const password = crypto.randomBytes(24).toString('hex');
  const pg = startContainer('pg', 'postgres:18-alpine', ['-p', '127.0.0.1::5432'], {POSTGRES_USER: 'piling', POSTGRES_DB: 'codex_test', POSTGRES_PASSWORD: password});
  let ready = false;
  for (let n = 0; n < 60; n++) {
    try { docker(['exec', pg, 'pg_isready', '-U', 'piling', '-d', 'codex_test']); ready = true; break; } catch { await sleep(1000); }
  }
  assert(ready, 'Restore PostgreSQL not ready');
  docker(['exec', '-i', pg, 'pg_restore', '-U', 'piling', '-d', 'codex_test', '--no-owner', '--no-acl', '--exit-on-error', '--single-transaction'], {input: zlib.gunzipSync(dump)});
  for (const grants of ['app-role-grants.sql', 'identity-role-grants.sql']) docker(['exec', '-i', pg, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'piling', '-d', 'codex_test'], {input: fs.readFileSync(path.join('scripts', grants))});
  docker(['exec', '-i', pg, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'piling', '-d', 'codex_test'], {input: `ALTER ROLE pilingtrack_app PASSWORD '${password}';`});
  cp.execFileSync(process.execPath, ['scripts/restore-drill-verify.cjs', downloadedDump, downloadedDump + '.manifest.json', pg], {windowsHide: true, stdio: 'pipe'});
  const minio = startContainer('s3', 'codex-s3-t5:e7', ['-p', '127.0.0.1::9000'], {MINIO_ROOT_USER: process.env.S3_ACCESS_KEY_ID, MINIO_ROOT_PASSWORD: process.env.S3_SECRET_ACCESS_KEY}, ['server', '/data']);
  const s3Port = mappedPort(minio, 9000);
  for (let n = 0; n < 30; n++) {
    try { if ((await fetch(`http://127.0.0.1:${s3Port}/minio/health/ready`)).ok) break; } catch {}
    await sleep(1000);
  }
  const restoredS3 = new S3Client({endpoint: `http://127.0.0.1:${s3Port}`, region: process.env.S3_REGION, forcePathStyle: true, credentials: {accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY}});
  clients.push(restoredS3);
  await restoredS3.send(new CreateBucketCommand({Bucket: process.env.S3_BUCKET}));
  for (const object of storedObjects) {
    const bytes = await getObject(source, backupBucket, 'objects/' + object.key);
    assert(digest(bytes) === digest(object.body), 'Backup asset digest mismatch');
    await restoredS3.send(new PutObjectCommand({Bucket: process.env.S3_BUCKET, Key: object.key, Body: bytes, ContentType: object.type}));
    assert(digest(await getObject(restoredS3, process.env.S3_BUCKET, object.key)) === digest(object.body), 'Restored object digest mismatch');
  }
  const pem = cp.execFileSync('C:/Program Files/Git/usr/bin/openssl.exe', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost', '-keyout', '-', '-out', '-'], {encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']});
  const key = pem.match(/-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----/)[0];
  const cert = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/)[0];
  const caPath = path.join(dir, 'public-ca.pem'); fs.writeFileSync(caPath, cert);
  proxy = https.createServer({key, cert}, (request, response) => {
    const target = http.request({hostname: '127.0.0.1', port: s3Port, path: request.url, method: request.method, headers: request.headers}, result => {response.writeHead(result.statusCode, result.headers); result.pipe(response);});
    target.on('error', () => {response.writeHead(502); response.end();});
    response.on('close', () => target.destroy()); request.pipe(target);
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const state = startContainer('state', 'redis:7-alpine', ['-p', '127.0.0.1::6379']);
  const cache = startContainer('cache', 'redis:7-alpine', ['-p', '127.0.0.1::6379']);
  const port = await freePort();
  const appBase = `http://127.0.0.1:${port}`;
  const appEnv = {...process.env, NODE_ENV: 'production', NODE_EXTRA_CA_CERTS: caPath, SESSION_SECRET: crypto.randomBytes(32).toString('hex'), DATABASE_URL: `postgresql://pilingtrack_app:${password}@127.0.0.1:${mappedPort(pg, 5432)}/codex_test`, REDIS_URL: `redis://127.0.0.1:${mappedPort(state, 6379)}`, REDIS_URL_CACHE: `redis://127.0.0.1:${mappedPort(cache, 6379)}`, S3_ENDPOINT: `https://127.0.0.1:${proxy.address().port}`};
  appEnv.DATABASE_URL_POSTGRES = appEnv.DATABASE_URL;
  sensitive.push(appEnv.DATABASE_URL, appEnv.SESSION_SECRET);
  const app = cp.spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', String(port), '-H', '127.0.0.1'], {env: appEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
  children.push(app);
  const log = fs.createWriteStream(path.join(dir, 'app.log'));
  app.stdout.on('data', chunk => log.write(redact(chunk))); app.stderr.on('data', chunk => log.write(redact(chunk))); app.on('close', () => log.end());
  ready = false;
  for (let n = 0; n < 60; n++) {
    try { if ((await fetch(appBase + '/api/health')).ok) { ready = true; break; } } catch {}
    assert(app.exitCode === null, 'Restored application exited'); await sleep(1000);
  }
  assert(ready, 'Restored application not ready');
  const cookie = await login(appBase);
  const reports = await api(appBase, `/api/reports/period?dateFrom=${report.date}&dateTo=${report.date}&siteId=${report.siteId}`, cookie).then(result => result.json());
  assert(JSON.stringify(reports).includes(report.reportId), 'Restored report missing from authenticated API');
  for (const asset of assets) {
    const signed = await api(appBase, `/api/media/${asset.id}/download`, cookie).then(result => result.json());
    const target = new URL(signed.url);
    assert(target.origin === appEnv.S3_ENDPOINT, 'Restored media points to source storage');
    assert(digest(await httpsBytes(target, cert)) === digest(asset.body), 'Restored media/PDF digest mismatch');
  }
  const result = {passed: true, recoverySeconds: Number(((Date.now() - started) / 1000).toFixed(2)), tables: Object.keys(manifest.snapshot.counts).length, restoredObjects: storedObjects.length, assets: assets.map(asset => ({contentType: asset.type, sha256: digest(asset.body)})), authenticatedReport: true, independentDatabaseAndStorage: true, productionRpoRto: 'not measured; synthetic local backup bucket, existing build'};
  fs.writeFileSync('output/acceptance-1018/service-restore-result.json', JSON.stringify(result, null, 2));
  console.info(JSON.stringify(result));
})().catch(error => {console.error(redact(error.message)); process.exitCode = 1;}).finally(async () => {
  for (const child of children) if (child.exitCode === null) cp.spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {windowsHide: true, stdio: 'ignore'});
  if (proxy) {proxy.closeAllConnections(); proxy.close();}
  if (owner) {
    for (const asset of assets) await owner.query('DELETE FROM "Media" WHERE id=$1', [asset.id]).catch(() => {});
    await owner.end();
  }
  if (source) {
    for (const asset of assets) await source.send(new DeleteObjectCommand({Bucket: process.env.S3_BUCKET, Key: asset.key})).catch(() => {});
    for (const Key of backupKeys) await source.send(new DeleteObjectCommand({Bucket: backupBucket, Key})).catch(() => {});
    if (backupBucket) await source.send(new DeleteBucketCommand({Bucket: backupBucket})).catch(() => {});
  }
  for (const client of clients) client.destroy();
  for (const name of names.reverse()) {
    assert(name.startsWith(prefix + '-') || name === `codex-pg-${suffix}`, 'Unsafe cleanup name');
    if (docker(['inspect', '-f', '{{index .Config.Labels "pilingtrack.codex.service-restore"}}', name]) === '1') docker(['rm', '-f', '--volumes', name]);
  }
});
