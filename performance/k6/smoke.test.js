/**
 * k6 Smoke Test — PilingTrack
 *
 * Quick baseline test: 10-50 users, 1 minute.
 * Verifies basic system stability before deeper testing.
 *
 * Usage:
 *   k6 run performance/k6/smoke.test.js
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const smokeLatency = new Trend('smoke_latency', true);
const smokeErrors = new Rate('smoke_errors');

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export const options = {
  vus: 20,
  duration: '1m',
  thresholds: {
    smoke_latency: ['p(95)<500'],
    smoke_errors: ['rate<0.05'],
  },
};

export function setup() {
  const healthRes = http.get(`${BASE_URL}/api/health`);
  check(healthRes, { 'health check passes': (r) => r.status === 200 });

  const loginRes = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({
      email: 'operator@piling.ru',
      password: __ENV.OPERATOR_PASSWORD || '0000',
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  if (loginRes.status !== 200) {
    throw new Error(`Smoke test setup failed: login returned ${loginRes.status}`);
  }

  return { token: JSON.parse(loginRes.body).accessToken || '' };
}

export default function runScenario(data) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${data.token}`,
  };

  group('Health', () => {
    const res = http.get(`${BASE_URL}/api/health`);
    check(res, { 'health 200': (r) => r.status === 200 });
    smokeLatency.add(res.timings.duration);
    smokeErrors.add(res.status >= 400);
  });

  group('Read', () => {
    const res = http.get(`${BASE_URL}/api/reports/my`, { headers });
    check(res, { 'reports 200': (r) => r.status === 200 });
    smokeLatency.add(res.timings.duration);
    smokeErrors.add(res.status >= 400);
  });

  sleep(2);
}

export function handleSummary(data) {
  return {
    'performance/results/smoke-summary.json': JSON.stringify(data),
    stdout: `\nSmoke Test Summary:
  Duration: ${(data.state.testRunDurationMs / 1000).toFixed(0)}s
  VUs: ${data.options.vus}
  p95: ${(data.metrics.smoke_latency?.values['p(95)'] || 0).toFixed(0)}ms
  Errors: ${((data.metrics.smoke_errors?.values.rate || 0) * 100).toFixed(2)}%
  Status: ${(data.metrics.smoke_errors?.values.rate || 0) < 0.05 ? '✅ PASS' : '❌ FAIL'}
`,
  };
}
