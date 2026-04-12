/**
 * k6 Batch Sync Load Test
 *
 * Tests the /api/sync/batch endpoint with 10-50 operations per request.
 * Expected: significantly higher throughput vs single-operation sync.
 *
 * Run:
 *   k6 run load-tests/load-http-batch.js --env SESSION_TOKEN=<token> --vus 200 --duration 60s
 */

import http from 'k6/http';
import { sleep, check, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

const batchErrorRate = new Rate('batch_error_rate');
const opsPerRequest = new Trend('ops_per_request', true);
const throughputOps = new Counter('throughput_ops');

export const options = {
  scenarios: {
    batch_test: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 200 },
        { duration: '1m', target: 500 },
        { duration: '1m', target: 500 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },

  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.05'],
    batch_error_rate: ['rate<0.05'],
  },
};

const BASE = __ENV.BASE_URL || 'http://localhost:3000';
const SITE_ID = __ENV.SITE_ID || 'cmnngqini009fvnjo5ccymjmm';
const SESSION_TOKEN = __ENV.SESSION_TOKEN || '';
const BATCH_SIZE = parseInt(__ENV.BATCH_SIZE) || 20; // operations per request

const pileGrades = ['grade-1', 'grade-2', 'grade-3'];
const drillingTypes = ['type-1', 'type-2'];
const downtimeReasons = ['reason-1', 'reason-2', 'reason-3'];

function generateOperations(vuId, iteration, batchSize) {
  const ops = [];

  for (let i = 0; i < batchSize; i++) {
    const shiftTypes = ['DAY', 'NIGHT'];
    const shiftType = shiftTypes[Math.floor(Math.random() * 2)];

    ops.push({
      id: `op-${vuId}-${iteration}-${i}-${Date.now()}`,
      type: 'REPORT_CREATE',
      entity: 'report',
      entityId: `report-${vuId}-${iteration}-${i}-${Date.now()}`,
      payload: {
        siteId: SITE_ID,
        date: new Date().toISOString().split('T')[0],
        shiftType,
        shiftStart: shiftType === 'DAY' ? '08:00' : '20:00',
        shiftEnd: shiftType === 'DAY' ? '20:00' : '08:00',
        equipmentId: `equip-${(vuId % 10) + 1}`,
        piles: [{ pileGradeId: pileGrades[vuId % pileGrades.length], count: Math.floor(Math.random() * 20) + 1 }],
        drillings: Math.random() > 0.5 ? [{ typeId: drillingTypes[vuId % drillingTypes.length], count: Math.floor(Math.random() * 5) + 1, metersPerUnit: 10 + Math.floor(Math.random() * 20), meters: 0 }] : [],
        downtimes: Math.random() > 0.7 ? [{ reasonId: downtimeReasons[vuId % downtimeReasons.length], duration: Math.floor(Math.random() * 120) + 5 }] : [],
      },
      localTimestamp: Date.now(),
    });
  }

  return ops;
}

export default function () {
  const vuId = __VU;
  const iteration = __ITER;
  const headers = {
    'Content-Type': 'application/json',
    'Cookie': `pt-session=${SESSION_TOKEN}`,
  };

  // ---- BATCH SYNC ----
  group('batch_sync', function () {
    const operations = generateOperations(vuId, iteration, BATCH_SIZE);
    opsPerRequest.add(operations.length);

    const res = http.post(`${BASE}/api/sync/batch`, JSON.stringify({ operations }), { headers });

    const ok = check(res, {
      'batch 200': (r) => r.status === 200,
      'batch processed > 0': (r) => {
        try {
          const body = r.json();
          return body.processed > 0;
        } catch { return false; }
      },
    });

    batchErrorRate.add(!ok);

    if (res.status === 200) {
      try {
        const body = res.json();
        throughputOps.add(body.processed || 0);
      } catch {
        throughputOps.add(operations.length);
      }
    }
  });

  // Sleep: 0.5-2s between batch requests
  sleep(0.5 + Math.random() * 1.5);
}
