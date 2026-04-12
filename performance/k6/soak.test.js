/**
 * k6 Soak Test — PilingTrack
 *
 * Long-running test (6+ hours) to detect memory leaks,
 * connection pool exhaustion, and gradual degradation.
 *
 * Usage:
 *   k6 run --vus 100 --duration 6h performance/k6/soak.test.js
 *
 * Monitor:
 *   - Memory growth over time
 *   - Latency drift
 *   - Error rate increase
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

const soakLatency = new Trend('soak_latency', true);
const soakErrors = new Rate('soak_errors');
const requestsTotal = new Counter('soak_requests_total');

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export const options = {
  vus: 100,
  duration: '6h',
  thresholds: {
    soak_latency: ['p(95)<500', 'p(99)<1000'],
    soak_errors: ['rate<0.01'],
  },
};

let authToken = '';

export function setup() {
  const loginRes = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({
      email: 'operator@piling.ru',
      password: __ENV.OPERATOR_PASSWORD || '0000',
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  if (loginRes.status !== 200) {
    throw new Error(`Login failed: ${loginRes.status}`);
  }

  authToken = JSON.parse(loginRes.body).accessToken || '';
  return { authToken };
}

export default function (data) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${data.authToken}`,
  };

  // Rotate between endpoints to simulate realistic traffic
  const endpoints = [
    { method: 'GET', path: '/api/health' },
    { method: 'GET', path: '/api/ready' },
    { method: 'GET', path: '/api/reports/my' },
    { method: 'GET', path: '/api/sites/all' },
    { method: 'GET', path: '/api/crews/all' },
    { method: 'GET', path: '/api/dictionary/all' },
  ];

  const ep = endpoints[Math.floor(Math.random() * endpoints.length)];
  const res = http.request(ep.method, `${BASE_URL}${ep.path}`, null, { headers });

  soakLatency.add(res.timings.duration);
  soakErrors.add(res.status >= 400);
  requestsTotal.add(1);

  check(res, {
    [`status 200: ${ep.method} ${ep.path}`]: (r) => r.status < 400,
  });

  sleep(Math.random() * 3 + 1); // 1-4s random sleep
}

export function handleSummary(data) {
  const durationH = (data.state.testRunDurationMs / (1000 * 60 * 60)).toFixed(2);
  return {
    'performance/results/soak-summary.json': JSON.stringify(data),
    stdout: `\nSoak Test Summary (${durationH}h):
  Total Requests: ${data.metrics.soak_requests_total?.values.count || 0}
  Avg Latency: ${(data.metrics.soak_latency?.values.avg || 0).toFixed(0)}ms
  p95 Latency: ${(data.metrics.soak_latency?.values['p(95)'] || 0).toFixed(0)}ms
  Error Rate: ${((data.metrics.soak_errors?.values.rate || 0) * 100).toFixed(3)}%
`,
  };
}
