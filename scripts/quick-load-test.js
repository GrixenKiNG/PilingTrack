/**
 * Smoke Load Test — PilingTrack with Auth + Cache
 *
 * Properly authenticated load test that hits REAL cached API endpoints.
 *
 * Usage: node scripts/quick-load-test.js
 */

const http = require('http');

const BASE = 'http://localhost:3000';
const USERS = 30;
const REQUESTS_PER_USER = 15;

// These are the ACTUAL cached read endpoints
const endpoints = [
  '/api/sites/all',
  '/api/crews/all',
  '/api/dictionary/all',
  '/api/equipment/all',
];

let authToken = '';
let sessionCookie = '';

class Metrics {
  constructor() {
    this.latencies = [];
    this.errors = 0;
    this.successes = 0;
    this.start = Date.now();
    this.byEndpoint = {};
  }
  record(lat, ok, endpoint) {
    this.latencies.push(lat);
    if (ok) this.successes++; else this.errors++;
    if (endpoint) {
      if (!this.byEndpoint[endpoint]) this.byEndpoint[endpoint] = { hits: 0, errors: 0, totalLat: 0 };
      this.byEndpoint[endpoint].hits++;
      this.byEndpoint[endpoint].totalLat += lat;
      if (!ok) this.byEndpoint[endpoint].errors++;
    }
  }
  p(pct) {
    if (!this.latencies.length) return 0;
    const s = [...this.latencies].sort((a, b) => a - b);
    return s[Math.floor((pct / 100) * (s.length - 1))];
  }
  avg() {
    if (!this.latencies.length) return 0;
    return this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length;
  }
}

const m = new Metrics();

function makeRequest(path, method = 'GET', body = null, headers = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const url = new URL(path, BASE);
    const opts = {
      hostname: url.hostname,
      port: url.port || 3000,
      path: url.pathname + url.search,
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      timeout: 15000,
    };
    const r = http.request(opts, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        const setCookie = res.headers['set-cookie'];
        resolve({
          lat: Date.now() - t0,
          ok: res.statusCode < 400,
          code: res.statusCode,
          body: d,
          cookie: setCookie ? setCookie[0] : null,
        });
      });
    });
    r.on('error', () => resolve({ lat: Date.now() - t0, ok: false, code: 0, body: '' }));
    r.on('timeout', () => { r.destroy(); resolve({ lat: Date.now() - t0, ok: false, code: -1, body: '' }); });
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function login() {
  // Try password auth
  const res = await makeRequest('/api/auth/login', 'POST', {
    email: 'loadtest@piling.ru',
    password: 'loadtest123',
  });
  if (res.ok && res.body) {
    try {
      const body = JSON.parse(res.body);
      if (body.accessToken) authToken = body.accessToken;
      if (res.cookie) sessionCookie = res.cookie.split(';')[0];
    } catch {}
  }

  if (authToken) {
    console.log(`   ✅ Authenticated with Bearer token`);
  } else if (sessionCookie) {
    console.log(`   ✅ Authenticated with session cookie`);
  } else {
    console.log(`   ⚠️  Auth failed — load test will get 401 on protected endpoints`);
  }
}

function getAuthHeaders() {
  const headers = {};
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
  if (sessionCookie) headers['Cookie'] = sessionCookie;
  return headers;
}

async function runUser() {
  const authHeaders = getAuthHeaders();

  for (let i = 0; i < REQUESTS_PER_USER; i++) {
    const ep = endpoints[Math.floor(Math.random() * endpoints.length)];
    const res = await makeRequest(ep, 'GET', null, authHeaders);
    m.record(res.lat, res.ok, ep);
  }
}

async function main() {
  console.log(`Load test: ${USERS} users x ${REQUESTS_PER_USER} reqs x ${endpoints.length} cached endpoints`);
  console.log(`Total: ~${USERS * REQUESTS_PER_USER} requests\n`);

  // Authenticate first
  console.log('🔐 Authenticating...');
  await login();
  console.log('');

  // Warmup — prime the cache
  console.log('🔥 Warming up cache (hitting each endpoint once)...');
  const authHeaders = getAuthHeaders();
  for (const ep of endpoints) {
    const res = await makeRequest(ep, 'GET', null, authHeaders);
    console.log(`   ${ep}: ${res.ok ? '✅ 200' : `❌ ${res.code}`} (${res.lat}ms)`);
  }
  console.log('');

  // Load test
  console.log('⚡ Running load test...');
  const t0 = Date.now();

  await Promise.all(Array.from({ length: USERS }, () => runUser()));
  const dur = (Date.now() - t0) / 1000;

  const total = m.successes + m.errors;
  const errRate = (m.errors / Math.max(1, total) * 100).toFixed(2);

  console.log('\n' + '═'.repeat(60));
  console.log('📊 RESULTS');
  console.log('═'.repeat(60));
  console.log(`  Duration:        ${dur.toFixed(1)}s`);
  console.log(`  Total Requests:  ${total}`);
  console.log(`  Success:         ${m.successes} (${(m.successes / Math.max(1, total) * 100).toFixed(1)}%)`);
  console.log(`  Errors:          ${m.errors} (${errRate}%)`);
  console.log(`  Throughput:      ${(total / dur).toFixed(1)} req/s`);
  console.log('');
  console.log('  ⏱️  Latency:');
  console.log(`    Avg:           ${m.avg().toFixed(1)} ms`);
  console.log(`    p50:           ${m.p(50)} ms`);
  console.log(`    p95:           ${m.p(95)} ms`);
  console.log(`    p99:           ${m.p(99)} ms`);
  console.log(`    Max:           ${Math.max(...m.latencies)} ms`);
  console.log('');

  // Per-endpoint breakdown
  console.log('  📈 Per-Endpoint:');
  for (const [ep, data] of Object.entries(m.byEndpoint)) {
    const avgLat = (data.totalLat / Math.max(1, data.hits)).toFixed(0);
    console.log(`    ${ep}: ${data.hits} hits, avg ${avgLat}ms, ${data.errors} errors`);
  }
  console.log('');

  console.log('🎯 KPI:');
  console.log(`  p95 < 200ms:     ${m.p(95) < 200 ? '✅ PASS' : '❌ FAIL'} (${m.p(95)}ms)`);
  console.log(`  p99 < 500ms:     ${m.p(99) < 500 ? '✅ PASS' : '❌ FAIL'} (${m.p(99)}ms)`);
  console.log(`  Errors < 1%:     ${parseFloat(errRate) < 1 ? '✅ PASS' : '❌ FAIL'} (${errRate}%)`);
  console.log('═'.repeat(60));
}

main().catch(console.error);
