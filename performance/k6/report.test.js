/**
 * k6 Report Test — PilingTrack
 *
 * Tests report creation, reading, and sync under load.
 * Simulates real operator workflow: login → create report → verify.
 *
 * Usage:
 *   k6 run --vus 200 --duration 5m performance/k6/report.test.js
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom metrics
const reportCreateLatency = new Trend('report_create_latency', true);
const reportReadLatency = new Trend('report_read_latency', true);
const reportErrors = new Rate('report_errors');
const reportsCreated = new Counter('reports_created_total');
const reportsRead = new Counter('reports_read_total');

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// Test data
const TEST_SITES = ['site-demo-1', 'site-demo-2'];
const TEST_EQUIPMENT = ['eq-pve-50pr', 'eq-lrh-100-1'];
const PILE_GRADES = ['pg-СВ 120-35', 'pg-СВ 150-50', 'pg-СВ 200-60'];
const DRILLING_TYPES = ['dt-Лидерное бурение d=150мм', 'dt-Лидерное бурение d=200мм'];
const DOWNTIME_REASONS = ['dr-Переезд установки', 'dr-Плохие погодные условия', 'dr-Ремонт установки'];
const SHIFTS = ['DAY', 'NIGHT'];

// Load profiles
export const options = {
  stages: [
    { duration: '30s', target: 20 },   // Ramp up
    { duration: '2m', target: 200 },   // Normal load
    { duration: '2m', target: 500 },   // Peak load
    { duration: '30s', target: 0 },    // Ramp down
  ],
  thresholds: {
    report_create_latency: ['p(95)<500', 'p(99)<1000'],
    report_read_latency: ['p(95)<300'],
    report_errors: ['rate<0.01'],
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

// Shared state
let authToken = '';
let userId = '';

export function setup() {
  // Login as operator
  const loginRes = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({
      email: 'operator@piling.ru',
      password: __ENV.OPERATOR_PASSWORD || '0000',
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  if (loginRes.status !== 200) {
    throw new Error(`Setup failed: login returned ${loginRes.status}`);
  }

  const body = JSON.parse(loginRes.body);
  authToken = body.accessToken || '';

  // Get user info
  const meRes = http.get(`${BASE_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });

  if (meRes.status === 200) {
    const me = JSON.parse(meRes.body);
    userId = me.id || '';
  }

  return { authToken, userId };
}

function generateReportId() {
  return `rpt-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
}

function generateReportPayload() {
  const siteId = TEST_SITES[Math.floor(Math.random() * TEST_SITES.length)];
  const shiftType = SHIFTS[Math.floor(Math.random() * SHIFTS.length)];
  const today = new Date().toISOString().split('T')[0];

  return {
    reportId: generateReportId(),
    siteId,
    date: today,
    shiftType,
    shiftStart: '08:00',
    shiftEnd: '20:00',
    equipmentId: TEST_EQUIPMENT[Math.floor(Math.random() * TEST_EQUIPMENT.length)],
    piles: [
      {
        pileGradeId: PILE_GRADES[Math.floor(Math.random() * PILE_GRADES.length)],
        count: Math.floor(Math.random() * 20) + 1,
      },
    ],
    drillings: [
      {
        typeId: DRILLING_TYPES[Math.floor(Math.random() * DRILLING_TYPES.length)],
        count: Math.floor(Math.random() * 5) + 1,
        metersPerUnit: 10,
        meters: (Math.random() * 50 + 10).toFixed(1),
      },
    ],
    downtimes: Math.random() > 0.7
      ? [
          {
            reasonId: DOWNTIME_REASONS[Math.floor(Math.random() * DOWNTIME_REASONS.length)],
            duration: Math.floor(Math.random() * 120) + 10,
            comment: 'Автоматический простой',
          },
        ]
      : [],
  };
}

export default function (data) {
  const token = data.authToken;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'Idempotency-Key': generateReportId(),
  };

  group('Create Report', () => {
    const payload = generateReportPayload();
    const res = http.post(`${BASE_URL}/api/reports/upsert`, JSON.stringify(payload), { headers });

    const success = check(res, {
      'report create status 200/201': (r) => r.status === 200 || r.status === 201,
      'report create latency < 500ms': (r) => r.timings.duration < 500,
    });

    reportCreateLatency.add(res.timings.duration);
    reportErrors.add(!success);

    if (success) {
      reportsCreated.add(1);
    }
  });

  sleep(0.5);

  group('Read Reports', () => {
    const res = http.get(`${BASE_URL}/api/reports/my`, { headers });

    const success = check(res, {
      'report read status 200': (r) => r.status === 200,
      'report read latency < 300ms': (r) => r.timings.duration < 300,
    });

    reportReadLatency.add(res.timings.duration);
    reportErrors.add(!success);

    if (success) {
      reportsRead.add(1);
    }
  });

  sleep(1);

  group('Sync Updates', () => {
    const since = Date.now() - 3600000;
    const res = http.get(`${BASE_URL}/api/sync/updates?since=${since}`, { headers });

    check(res, {
      'sync status 200': (r) => r.status === 200,
    });
  });

  sleep(2);
}

export function handleSummary(data) {
  return {
    'performance/results/report-summary.json': JSON.stringify(data),
    stdout: `\nReport Test Summary:
  Duration: ${(data.state.testRunDurationMs / 1000).toFixed(0)}s
  Reports Created: ${data.metrics.reports_created_total?.values.count || 0}
  Reports Read: ${data.metrics.reports_read_total?.values.count || 0}
  Create p95: ${(data.metrics.report_create_latency?.values['p(95)'] || 0).toFixed(0)}ms
  Read p95: ${(data.metrics.report_read_latency?.values['p(95)'] || 0).toFixed(0)}ms
  Error Rate: ${((data.metrics.report_errors?.values.rate || 0) * 100).toFixed(2)}%
`,
  };
}
