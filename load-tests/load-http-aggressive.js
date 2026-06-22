/**
 * Aggressive HTTP Load Test — Real Production Load
 *
 * Target: ~500-800 RPS sustained
 * Each VU makes 1-2 requests per second
 *
 * Run:
 *   k6 run load-tests/load-http-aggressive.js --env SESSION_TOKEN=<token>
 */

import http from 'k6/http';
import { sleep, check, group } from 'k6';
import { Rate } from 'k6/metrics';

const syncErrorRate = new Rate('sync_error_rate');
const pullErrorRate = new Rate('pull_sync_error_rate');

export const options = {
  scenarios: {
    ramp_to_1000: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 200 },   // Warm-up
        { duration: '2m', target: 500 },   // Medium load
        { duration: '3m', target: 1000 },  // Peak load
        { duration: '3m', target: 1000 },  // Sustained
        { duration: '1m', target: 0 },     // Cool-down
      ],
      gracefulRampDown: '10s',
    },
  },

  thresholds: {
    http_req_duration: [
      'p(50)<100',
      'p(90)<300',
      'p(95)<500',
      'p(99)<1000',
    ],
    http_req_failed: ['rate<0.05'],
    sync_error_rate: ['rate<0.05'],
    pull_sync_error_rate: ['rate<0.05'],
  },
};

const BASE = __ENV.BASE_URL || 'http://localhost:3000';
const SITE_ID = __ENV.SITE_ID || 'cmnngqini009fvnjo5ccymjmm';
const SESSION_TOKEN = __ENV.SESSION_TOKEN || '';

const pileGrades = ['grade-1', 'grade-2', 'grade-3'];
const drillingTypes = ['type-1', 'type-2'];
const downtimeReasons = ['reason-1', 'reason-2', 'reason-3'];

function generateReportPayload(vuId, iteration) {
  const shiftTypes = ['DAY', 'NIGHT'];
  const shiftType = shiftTypes[Math.floor(Math.random() * 2)];

  return {
    reportId: `report-${vuId}-${iteration}-${Date.now()}`,
    siteId: SITE_ID,
    date: new Date().toISOString().split('T')[0],
    shiftType,
    shiftStart: shiftType === 'DAY' ? '08:00' : '20:00',
    shiftEnd: shiftType === 'DAY' ? '20:00' : '08:00',
    equipmentId: `equip-${(vuId % 10) + 1}`,
    piles: [{ pileGradeId: pileGrades[vuId % pileGrades.length], count: Math.floor(Math.random() * 20) + 1 }],
    drillings: Math.random() > 0.5 ? [{ typeId: drillingTypes[vuId % drillingTypes.length], count: Math.floor(Math.random() * 5) + 1, metersPerUnit: 10 + Math.floor(Math.random() * 20), meters: 0 }] : [],
    downtimes: Math.random() > 0.7 ? [{ reasonId: downtimeReasons[vuId % downtimeReasons.length], duration: Math.floor(Math.random() * 120) + 5 }] : [],
  };
}

export default function runScenario() {
  const vuId = __VU;
  const iteration = __ITER;
  const headers = {
    'Content-Type': 'application/json',
    'Cookie': `pt-session=${SESSION_TOKEN}`,
  };

  // ---- PUSH SYNC ----
  group('push_sync', function () {
    const operations = [{
      id: `op-${vuId}-${iteration}-${Date.now()}`,
      type: 'REPORT_CREATE',
      entity: 'report',
      entityId: `report-${vuId}-${iteration}-${Date.now()}`,
      payload: generateReportPayload(vuId, iteration),
      localTimestamp: Date.now(),
    }];

    const res = http.post(`${BASE}/api/sync`, JSON.stringify({ operations }), { headers });
    const ok = check(res, { 'push 200': (r) => r.status === 200 });
    syncErrorRate.add(!ok);
  });

  // Fast sleep: 0.5-1.5s → ~1-2 req/sec per VU
  sleep(0.5 + Math.random());

  // ---- PULL SYNC ----
  group('pull_sync', function () {
    const since = Date.now() - 60000;
    const res = http.get(`${BASE}/api/sync/updates?since=${since}`, { headers });
    const ok = check(res, { 'pull 200': (r) => r.status === 200 });
    pullErrorRate.add(!ok);
  });

  // Fast sleep: 0.3-1s
  sleep(0.3 + Math.random() * 0.7);
}
