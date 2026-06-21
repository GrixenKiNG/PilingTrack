/**
 * k6 Spike Test — PilingTrack
 *
 * Simulates sudden traffic spike (e.g., all operators coming online
 * after network restoration or shift change).
 *
 * Scenario: 0 → 1000 VU in 10 seconds → hold → drop → recover
 *
 * Usage:
 *   k6 run performance/k6/spike.test.js
 */

import http from 'k6/http';
import { sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const spikeLatency = new Trend('spike_latency', true);
const spikeErrors = new Rate('spike_errors');

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export const options = {
  stages: [
    { duration: '10s', target: 1000 },  // SPIKE: 0 → 1000 in 10s
    { duration: '30s', target: 1000 },  // Hold peak
    { duration: '10s', target: 100 },   // Drop
    { duration: '1m', target: 100 },    // Recovery
    { duration: '10s', target: 0 },     // Cool down
  ],
  thresholds: {
    spike_latency: ['p(95)<1000', 'p(99)<3000'],
    spike_errors: ['rate<0.05'],
    http_req_failed: ['rate<0.05'],
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

export default function runScenario(data) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${data.authToken}`,
  };

  // Mixed workload: 60% read, 30% write, 10% sync
  const action = Math.random();

  if (action < 0.6) {
    // Read operation
    const res = http.get(`${BASE_URL}/api/reports/my`, { headers });
    spikeLatency.add(res.timings.duration);
    spikeErrors.add(res.status >= 400);
  } else if (action < 0.9) {
    // Write operation
    const payload = {
      reportId: `rpt-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      siteId: 'site-demo-1',
      date: new Date().toISOString().split('T')[0],
      shiftType: 'DAY',
      piles: [{ pileGradeId: 'pg-СВ 120-35', count: Math.floor(Math.random() * 10) + 1 }],
    };
    const res = http.post(`${BASE_URL}/api/reports/upsert`, JSON.stringify(payload), { headers });
    spikeLatency.add(res.timings.duration);
    spikeErrors.add(res.status >= 400);
  } else {
    // Sync operation
    const res = http.get(`${BASE_URL}/api/sync/updates?since=${Date.now() - 3600000}`, { headers });
    spikeLatency.add(res.timings.duration);
    spikeErrors.add(res.status >= 400);
  }

  sleep(1);
}

export function handleSummary(data) {
  return {
    'performance/results/spike-summary.json': JSON.stringify(data),
    stdout: `\nSpike Test Summary:
  Peak VU: 1000
  Spike p95: ${(data.metrics.spike_latency?.values['p(95)'] || 0).toFixed(0)}ms
  Spike p99: ${(data.metrics.spike_latency?.values['p(99)'] || 0).toFixed(0)}ms
  Error Rate: ${((data.metrics.spike_errors?.values.rate || 0) * 100).toFixed(2)}%
  Recovered: ${data.metrics.http_req_failed?.values.rate < 0.05 ? '✅ YES' : '❌ NO'}
`,
  };
}
