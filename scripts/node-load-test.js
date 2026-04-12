/**
 * Node.js Load Test — PilingTrack
 * 
 * Tests HTTP API performance under concurrent load.
 * No external dependencies — uses built-in http module.
 * 
 * Usage: node scripts/node-load-test.js
 */

const http = require('http');
const https = require('https');

// ============================================================
// Configuration
// ============================================================

const CONFIG = {
  baseUrl: 'http://localhost:3000',
  concurrentUsers: 50,
  requestsPerUser: 20,
  warmupRequests: 10,
};

// ============================================================
// Metrics
// ============================================================

class Metrics {
  constructor() {
    this.latencies = [];
    this.errors = 0;
    this.successes = 0;
    this.total = 0;
    this.startTime = Date.now();
  }

  record(latencyMs, success) {
    this.latencies.push(latencyMs);
    this.total++;
    if (success) this.successes++;
    else this.errors++;
  }

  p50() { return this.percentile(50); }
  p95() { return this.percentile(95); }
  p99() { return this.percentile(99); }
  avg() {
    if (this.latencies.length === 0) return 0;
    return this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length;
  }
  percentile(p) {
    if (this.latencies.length === 0) return 0;
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const idx = Math.floor((p / 100) * (sorted.length - 1));
    return sorted[idx];
  }
}

const apiMetrics = new Metrics();
const wsMetrics = new Metrics();
const authMetrics = new Metrics();

// ============================================================
// HTTP Request Helper
// ============================================================

function makeRequest(url, method = 'GET', body = null, headers = {}) {
  return new Promise((resolve) => {
    const start = Date.now();
    const urlObj = new URL(url, CONFIG.baseUrl);
    
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 3000,
      path: urlObj.pathname + urlObj.search,
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      timeout: 10000,
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const latency = Date.now() - start;
        const success = res.statusCode >= 200 && res.statusCode < 400;
        resolve({ latency, success, statusCode: res.statusCode, body: data });
      });
    });

    req.on('error', () => {
      const latency = Date.now() - start;
      resolve({ latency, success: false, statusCode: 0, body: '' });
    });

    req.on('timeout', () => {
      req.destroy();
      const latency = Date.now() - start;
      resolve({ latency, success: false, statusCode: 0, body: 'timeout' });
    });

    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ============================================================
// Test Scenarios
// ============================================================

async function testHealth(metrics) {
  const res = await makeRequest('/api/health');
  metrics.record(res.latency, res.success);
  return res.success;
}

async function testLogin(metrics) {
  const res = await makeRequest('/api/auth/login', 'POST', {
    email: 'operator@piling.ru',
    password: '0000',
  });
  metrics.record(res.latency, res.success);
  return res;
}

async function testGetSites(metrics, cookie) {
  const res = await makeRequest('/api/sites/all', 'GET', null, { Cookie: cookie || '' });
  metrics.record(res.latency, res.success);
}

async function testGetCrews(metrics, cookie) {
  const res = await makeRequest('/api/crews/all', 'GET', null, { Cookie: cookie || '' });
  metrics.record(res.latency, res.success);
}

async function testGetDictionary(metrics, cookie) {
  const res = await makeRequest('/api/dictionary/all', 'GET', null, { Cookie: cookie || '' });
  metrics.record(res.latency, res.success);
}

async function testGetReports(metrics, cookie) {
  const res = await makeRequest('/api/reports/my', 'GET', null, { Cookie: cookie || '' });
  metrics.record(res.latency, res.success);
}

async function testSyncUpdates(metrics, cookie) {
  const since = Date.now() - 3600000;
  const res = await makeRequest(`/api/sync/updates?since=${since}`, 'GET', null, { Cookie: cookie || '' });
  metrics.record(res.latency, res.success);
}

// ============================================================
// Load Generator
// ============================================================

async function runUserScenario(metrics, scenarioName) {
  try {
    // Mixed workload simulating real operator behavior
    await testHealth(metrics);
    const loginRes = await testLogin(authMetrics);
    const cookie = loginRes.body ? (() => {
      try { return JSON.parse(loginRes.body).setCookie || ''; } catch { return ''; }
    })() : '';
    
    await testGetSites(metrics, cookie);
    await testGetCrews(metrics, cookie);
    await testGetDictionary(metrics, cookie);
    await testGetReports(metrics, cookie);
    await testSyncUpdates(metrics, cookie);
  } catch (e) {
    // Silently fail — counted in metrics
  }
}

async function runLoadTest() {
  console.log('🚀 PilingTrack Load Test');
  console.log(`   Concurrent users: ${CONFIG.concurrentUsers}`);
  console.log(`   Requests per user: ${CONFIG.requestsPerUser}`);
  console.log(`   Total requests: ~${CONFIG.concurrentUsers * CONFIG.requestsPerUser * 7}`);
  console.log('');

  // Warmup
  console.log('🔥 Warming up...');
  for (let i = 0; i < CONFIG.warmupRequests; i++) {
    await testHealth(apiMetrics);
  }
  console.log('   Warmup complete\n');

  // Load test
  console.log('⚡ Running load test...');
  const testStart = Date.now();

  const userPromises = [];
  for (let u = 0; u < CONFIG.concurrentUsers; u++) {
    const userPromise = (async () => {
      for (let r = 0; r < CONFIG.requestsPerUser; r++) {
        await runUserScenario(apiMetrics, `user-${u}`);
      }
    })();
    userPromises.push(userPromise);
  }

  await Promise.all(userPromises);
  const testDuration = (Date.now() - testStart) / 1000;

  // Results
  console.log('\n' + '='.repeat(60));
  console.log('📊 LOAD TEST RESULTS');
  console.log('='.repeat(60));
  console.log(`   Duration:          ${testDuration.toFixed(1)}s`);
  console.log(`   Total Requests:    ${apiMetrics.total}`);
  console.log(`   Successful:        ${apiMetrics.successes} (${((apiMetrics.successes / apiMetrics.total) * 100).toFixed(1)}%)`);
  console.log(`   Failed:            ${apiMetrics.errors} (${((apiMetrics.errors / apiMetrics.total) * 100).toFixed(1)}%)`);
  console.log(`   Throughput:        ${(apiMetrics.total / testDuration).toFixed(1)} req/s`);
  console.log('');
  console.log('   📈 Latency (API):');
  console.log(`     Avg:             ${apiMetrics.avg().toFixed(1)} ms`);
  console.log(`     p50:             ${apiMetrics.p50()} ms`);
  console.log(`     p95:             ${apiMetrics.p95()} ms`);
  console.log(`     p99:             ${apiMetrics.p99()} ms`);
  console.log('');
  console.log('   🔐 Auth:');
  console.log(`     Total:           ${authMetrics.total}`);
  console.log(`     Success Rate:    ${((authMetrics.successes / Math.max(1, authMetrics.total)) * 100).toFixed(1)}%`);
  console.log(`     p95 Latency:     ${authMetrics.p95()} ms`);
  console.log('');
  
  // KPI Check
  console.log('='.repeat(60));
  console.log('🎯 KPI CHECK');
  console.log('='.repeat(60));
  const p95ok = apiMetrics.p95() < 200;
  const p99ok = apiMetrics.p99() < 500;
  const errorOk = (apiMetrics.errors / Math.max(1, apiMetrics.total)) < 0.01;
  
  console.log(`   p95 < 200ms:       ${p95ok ? '✅ PASS' : '❌ FAIL'} (${apiMetrics.p95()}ms)`);
  console.log(`   p99 < 500ms:       ${p99ok ? '✅ PASS' : '❌ FAIL'} (${apiMetrics.p99()}ms)`);
  console.log(`   Error rate < 1%:   ${errorOk ? '✅ PASS' : '❌ FAIL'} (${((apiMetrics.errors / Math.max(1, apiMetrics.total)) * 100).toFixed(2)}%)`);
  console.log('');

  const allPass = p95ok && p99ok && errorOk;
  console.log(`   Overall:           ${allPass ? '🏆 PRODUCTION READY' : '⚠️  NEEDS OPTIMIZATION'}`);
  console.log('='.repeat(60));
}

runLoadTest().catch(console.error);
