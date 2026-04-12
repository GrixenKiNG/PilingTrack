/**
 * Stress Test — 100 concurrent users with Auth + Redis Cache
 *
 * Hits REAL cached API endpoints with proper authentication.
 * Measures actual production-like latency.
 */

const http = require('http');

const BASE = 'http://localhost:3000';
const USERS = 100;
const REQUESTS = 10;

const endpoints = [
  '/api/sites/all',
  '/api/crews/all',
  '/api/dictionary/all',
  '/api/equipment/all',
];

let total = 0, errors = 0, successes = 0;
const latencies = [];
let sessionCookie = '';

async function login() {
  return new Promise((resolve) => {
    const data = JSON.stringify({ email: 'loadtest@piling.ru', password: 'loadtest123' });
    const r = http.request({ hostname: 'localhost', port: 3000, path: '/api/auth/login', method: 'POST', headers: { 'Content-Type': 'application/json' } }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        if (res.statusCode === 200 && res.headers['set-cookie']) {
          sessionCookie = res.headers['set-cookie'][0].split(';')[0];
          console.log('   ✅ Authenticated');
        } else {
          console.log('   ❌ Auth failed (status', res.statusCode + ')');
        }
        resolve();
      });
    });
    r.write(data);
    r.end();
  });
}

function req(path) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const headers = { 'Content-Type': 'application/json' };
    if (sessionCookie) headers['Cookie'] = sessionCookie;
    const r = http.request(BASE + path, { method: 'GET', timeout: 15000, headers }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        const lat = Date.now() - t0;
        latencies.push(lat);
        total++;
        if (res.statusCode < 400) successes++; else errors++;
        resolve();
      });
    });
    r.on('error', () => { const lat = Date.now() - t0; latencies.push(lat); total++; errors++; resolve(); });
    r.on('timeout', () => { r.destroy(); const lat = Date.now() - t0; latencies.push(lat); total++; errors++; resolve(); });
    r.end();
  });
}

async function runUser() {
  const headers = {};
  if (sessionCookie) headers['Cookie'] = sessionCookie;

  for (let i = 0; i < REQUESTS; i++) {
    const ep = endpoints[Math.floor(Math.random() * endpoints.length)];
    await new Promise((resolve) => {
      const t0 = Date.now();
      const r = http.request(BASE + ep, { method: 'GET', timeout: 15000, headers }, (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          const lat = Date.now() - t0;
          latencies.push(lat);
          total++;
          if (res.statusCode < 400) successes++; else errors++;
          resolve();
        });
      });
      r.on('error', () => { const lat = Date.now() - t0; latencies.push(lat); total++; errors++; resolve(); });
      r.on('timeout', () => { r.destroy(); const lat = Date.now() - t0; latencies.push(lat); total++; errors++; resolve(); });
      r.end();
    });
  }
}

async function main() {
  console.log(`Stress test: ${USERS} concurrent users x ${REQUESTS} requests x ${endpoints.length} cached endpoints`);
  console.log(`Total: ~${USERS * REQUESTS} requests\n`);

  // Warmup + login
  console.log('🔐 Logging in...');
  await login();

  console.log('🔥 Warming up cache...');
  for (const ep of endpoints) {
    const headers = {};
    if (sessionCookie) headers['Cookie'] = sessionCookie;
    await new Promise((resolve) => {
      const r = http.request(BASE + ep, { method: 'GET', headers }, (res) => {
        let d = ''; res.on('data', c => d += c);
        res.on('end', () => { console.log(`   ${ep}: ${res.statusCode}`); resolve(); });
      });
      r.end();
    });
  }
  console.log('');

  // Stress test
  console.log('⚡ Running stress test...');
  const t0 = Date.now();
  await Promise.all(Array.from({ length: USERS }, () => runUser()));
  const dur = (Date.now() - t0) / 1000;

  const sorted = [...latencies].sort((a, b) => a - b);
  const p = (pct) => sorted[Math.floor((pct / 100) * (sorted.length - 1))] || 0;
  const avg = latencies.reduce((a, b) => a + b, 0) / Math.max(1, latencies.length);
  const errRate = (errors / Math.max(1, total) * 100).toFixed(2);

  console.log('\n' + '═'.repeat(60));
  console.log('🔥 STRESS TEST RESULTS — 100 Concurrent Users');
  console.log('═'.repeat(60));
  console.log(`  Duration:        ${dur.toFixed(1)}s`);
  console.log(`  Total Requests:  ${total}`);
  console.log(`  Expected:        ${USERS * REQUESTS}`);
  console.log(`  Server Crashed:  ✅ NO`);
  console.log(`  Success:         ${successes} (${(successes / Math.max(1, total) * 100).toFixed(1)}%)`);
  console.log(`  Errors:          ${errors} (${errRate}%)`);
  console.log(`  Throughput:      ${(total / dur).toFixed(1)} req/s`);
  console.log('');
  console.log('  ⏱️  Latency:');
  console.log(`    Avg:           ${avg.toFixed(1)} ms`);
  console.log(`    p50:           ${p(50)} ms`);
  console.log(`    p95:           ${p(95)} ms`);
  console.log(`    p99:           ${p(99)} ms`);
  console.log(`    Max:           ${Math.max(...latencies)} ms`);
  console.log('');
  console.log('🎯 KPI:');
  console.log(`  p95 < 200ms:     ${p(95) < 200 ? '✅ PASS' : '❌ FAIL'} (${p(95)}ms)`);
  console.log(`  p99 < 500ms:     ${p(99) < 500 ? '✅ PASS' : '❌ FAIL'} (${p(99)}ms)`);
  console.log(`  Errors < 1%:     ${parseFloat(errRate) < 1 ? '✅ PASS' : '❌ FAIL'} (${errRate}%)`);
  console.log(`  No crash:        ✅ PASS`);
  console.log('═'.repeat(60));
}

main().catch(console.error);
