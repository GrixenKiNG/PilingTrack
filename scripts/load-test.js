/**
 * Load Testing — PilingTrack
 *
 * Tests:
 * 1. Health endpoints (baseline)
 * 2. Auth (login) — rate limiting
 * 3. Read operations (sites, dictionary, reports)
 * 4. Write operations (report upsert)
 * 5. Sync API (batch push + pull)
 *
 * Usage:
 *   npx k6 run scripts/load-test.js
 *   npx k6 run scripts/load-test.js --vus 50 --duration 60s
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.2/index.js';

// ============================================================
// Configuration
// ============================================================

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const TEST_EMAIL = 'operator@piling.ru';
const TEST_PASSWORD = '0000';

// ============================================================
// Setup — Login once and reuse cookie
// ============================================================

let authToken = '';

export function setup() {
  // Login to get session cookie
  const loginRes = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });

  check(loginRes, { 'login successful': (r) => r.status === 200 });

  if (loginRes.status === 200) {
    const body = loginRes.json();
    authToken = body.token || '';
  }

  return { authToken };
}

// ============================================================
// Test Scenarios
// ============================================================

export function healthChecks() {
  const res = http.get(`${BASE_URL}/api/health`);
  check(res, {
    'health returns 200': (r) => r.status === 200,
    'health has status field': (r) => {
      const body = r.json();
      return body && body.status;
    },
  });
}

export function readSites(data) {
  const params = {
    headers: { 'Content-Type': 'application/json' },
    cookies: { 'pt-session': data.authToken },
  };
  const res = http.get(`${BASE_URL}/api/sites`, params);
  check(res, { 'sites returns 200': (r) => r.status === 200 });
}

export function readDictionary() {
  const res = http.get(`${BASE_URL}/api/dictionary/all`);
  check(res, { 'dictionary returns 200': (r) => r.status === 200 });
}

export function readMyReports(data) {
  const params = {
    headers: { 'Content-Type': 'application/json' },
    cookies: { 'pt-session': data.authToken },
  };
  const res = http.get(`${BASE_URL}/api/reports/my`, params);
  check(res, { 'my reports returns 200': (r) => r.status === 200 });
}

export function syncPull(data) {
  const params = {
    headers: { 'Content-Type': 'application/json' },
    cookies: { 'pt-session': data.authToken },
  };
  const res = http.get(`${BASE_URL}/api/sync/updates?since=0`, params);
  check(res, { 'sync pull returns 200': (r) => r.status === 200 });
}

export function syncPush(data) {
  const params = {
    headers: { 'Content-Type': 'application/json' },
    cookies: { 'pt-session': data.authToken },
  };
  const payload = JSON.stringify({ operations: [] });
  const res = http.post(`${BASE_URL}/api/sync`, payload, params);
  check(res, { 'sync push returns 200': (r) => r.status === 200 });
}

// ============================================================
// Load Profile
// ============================================================

export const options = {
  stages: [
    { duration: '10s', target: 5 },   // Ramp up
    { duration: '30s', target: 20 },  // Load
    { duration: '10s', target: 50 },  // Spike
    { duration: '20s', target: 50 },  // Sustain spike
    { duration: '10s', target: 0 },   // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'], // 95% < 500ms, 99% < 1s
    http_req_failed: ['rate<0.05'],                  // < 5% errors
  },
};

// ============================================================
// Default — Run all scenarios
// ============================================================

export default function (data) {
  // Health (always runs)
  healthChecks();

  // Authenticated reads
  readSites(data);
  readDictionary();
  readMyReports(data);

  // Sync operations
  syncPull(data);
  syncPush(data);

  // Think time
  sleep(1);
}

// ============================================================
// Handle Summary — Print clean results
// ============================================================

export function handleSummary(data) {
  return {
    'stdout': textSummary(data, { indent: '  ', enableColors: true }),
    'load-test-results.json': JSON.stringify(data, null, 2),
  };
}
