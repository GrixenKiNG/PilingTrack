/**
 * Quick HTTP Load Test — 2 min smoke test
 */

import http from 'k6/http';
import { sleep, check, group } from 'k6';
import { Rate } from 'k6/metrics';

const syncErrorRate = new Rate('sync_error_rate');

export const options = {
  scenarios: {
    quick_test: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 50 },
        { duration: '1m', target: 200 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.05'],
    sync_error_rate: ['rate<0.05'],
  },
};

const BASE = __ENV.BASE_URL || 'http://localhost:3000';
const SITE_ID = __ENV.SITE_ID || 'cmnngqini009fvnjo5ccymjmm';
const SESSION_TOKEN = __ENV.SESSION_TOKEN || '';

const pileGrades = ['grade-1', 'grade-2', 'grade-3'];
const drillingTypes = ['type-1', 'type-2'];
const downtimeReasons = ['reason-1', 'reason-2', 'reason-3'];

function generateReportPayload(vuId, iteration) {
  const reportId = `report-${vuId}-${iteration}-${Date.now()}`;
  const shiftTypes = ['DAY', 'NIGHT'];
  const shiftType = shiftTypes[Math.floor(Math.random() * 2)];

  return {
    reportId,
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
    const ok = check(res, { 'push status 200': (r) => r.status === 200 });
    syncErrorRate.add(!ok);
  });

  sleep(2 + Math.random() * 3);

  group('pull_sync', function () {
    const since = Date.now() - 300000;
    const res = http.get(`${BASE}/api/sync/updates?since=${since}`, { headers });
    check(res, { 'pull status 200': (r) => r.status === 200 });
  });

  sleep(1 + Math.random() * 2);
}
