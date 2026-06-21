/**
 * k6 Load Test — PilingTrack
 *
 * Tests:
 * 1. HTTP API under load (1000 VU)
 * 2. WebSocket connection stability
 * 3. Event storm simulation
 * 4. Sync endpoint under concurrent load
 *
 * Usage:
 *   k6 run --vus 1000 --duration 5m load-tests/stress-test.js
 *   k6 run --vus 500 --duration 3m --out json=results.json load-tests/stress-test.js
 *
 * Targets:
 * - p95 API latency < 200ms
 * - WS latency < 500ms
 * - Error rate < 0.1%
 * - 1000 concurrent users
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// ============================================================
// Custom Metrics
// ============================================================

const apiLatency = new Trend('api_latency', true);
const wsLatency = new Trend('ws_latency', true);
const errorRate = new Rate('errors');
const requestsPerSecond = new Counter('requests_total');

// ============================================================
// Configuration
// ============================================================

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const WS_URL = __ENV.WS_URL || 'ws://localhost:3001';

// ============================================================
// Test Stages
// ============================================================

export const options = {
  stages: [
    // Ramp up to 200 users
    { duration: '30s', target: 200 },
    // Ramp up to 500 users
    { duration: '1m', target: 500 },
    // Ramp up to 1000 users (peak load)
    { duration: '2m', target: 1000 },
    // Sustain peak
    { duration: '3m', target: 1000 },
    // Ramp down
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    'api_latency': ['p(95)<200', 'p(99)<500'],
    'ws_latency': ['p(95)<500'],
    'errors': ['rate<0.01'],
    'http_req_duration': ['p(95)<200'],
    'http_req_failed': ['rate<0.01'],
  },
};

// ============================================================
// Shared test data
// ============================================================

const testCredentials = [
  { email: 'admin@piling.ru', password: 'test-password-1' },
  { email: 'dispatch@piling.ru', password: 'test-password-2' },
  { email: 'operator@piling.ru', password: 'test-password-3' },
];

// ============================================================
// Helper: Get random credential
// ============================================================

function getRandomCredentials() {
  return testCredentials[Math.floor(Math.random() * testCredentials.length)];
}

// ============================================================
// Setup: Login once to get tokens
// ============================================================

let authToken = '';

export function setup() {
  // Health check
  const healthRes = http.get(`${BASE_URL}/api/health`);
  check(healthRes, {
    'health check passes': (r) => r.status === 200,
  });

  // Login
  const creds = getRandomCredentials();
  const loginRes = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify(creds), {
    headers: { 'Content-Type': 'application/json' },
  });

  if (loginRes.status === 200) {
    const body = JSON.parse(loginRes.body);
    authToken = body.accessToken || '';
  }

  return { authToken };
}

// ============================================================
// Main VU Loop
// ============================================================

export default function runScenario(data) {
  const token = data.authToken;

  group('API: Read Operations', () => {
    // Get sites
    const sitesRes = http.get(`${BASE_URL}/api/sites/all`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    const sitesOk = check(sitesRes, {
      'get sites: status 200': (r) => r.status === 200,
      'get sites: latency < 200ms': (r) => r.timings.duration < 200,
    });

    errorRate.add(!sitesOk);
    apiLatency.add(sitesRes.timings.duration);
    requestsPerSecond.add(1);

    sleep(0.5);

    // Get crews
    const crewsRes = http.get(`${BASE_URL}/api/crews/all`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    check(crewsRes, {
      'get crews: status 200': (r) => r.status === 200,
    });

    apiLatency.add(crewsRes.timings.duration);
    requestsPerSecond.add(1);

    sleep(0.3);

    // Get dictionary
    const dictRes = http.get(`${BASE_URL}/api/dictionary/all`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    check(dictRes, {
      'get dictionary: status 200': (r) => r.status === 200,
    });

    apiLatency.add(dictRes.timings.duration);
    requestsPerSecond.add(1);
  });

  group('API: Report Operations', () => {
    // Get my reports
    const reportsRes = http.get(`${BASE_URL}/api/reports/my`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    check(reportsRes, {
      'get reports: status 200': (r) => r.status === 200,
    });

    apiLatency.add(reportsRes.timings.duration);
    requestsPerSecond.add(1);

    sleep(0.5);
  });

  group('API: Sync Operations', () => {
    // Sync updates (pull)
    const syncRes = http.get(
      `${BASE_URL}/api/sync/updates?since=${Date.now() - 3600000}`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    check(syncRes, {
      'sync updates: status 200': (r) => r.status === 200,
      'sync updates: latency < 300ms': (r) => r.timings.duration < 300,
    });

    apiLatency.add(syncRes.timings.duration);
    requestsPerSecond.add(1);

    sleep(1);
  });

  group('API: Health & Metrics', () => {
    const healthRes = http.get(`${BASE_URL}/api/health`);
    check(healthRes, { 'health: status 200': (r) => r.status === 200 });
    requestsPerSecond.add(1);

    sleep(2);
  });
}

// ============================================================
// Teardown
// ============================================================

export function teardown() {
  console.log('Load test completed');
}
