/**
 * k6 Combined Load Test — HTTP + WS + Event Storm
 *
 * Full production simulation:
 * - HTTP: operator sync (push + pull)
 * - WS: dispatcher dashboard connections
 * - Event Storm: real-time event flood via Redis
 *
 * Run:
 *   1. Start Event Storm in background:
 *      npx tsx load-tests/event-storm.ts 500 120 &
 *
 *   2. Start WS load test:
 *      k6 run load-tests/load-ws-quick.js --vus 100 --duration 120s
 *
 *   3. Start HTTP load test:
 *      k6 run load-tests/load-http-aggressive.js --env SESSION_TOKEN=<token> --vus 100 --duration 120s
 *
 * OR run all in one k6 instance (HTTP + WS):
 *   k6 run load-tests/load-combined.js --env SESSION_TOKEN=<token> --vus 200 --duration 120s
 */

import http from 'k6/http';
import ws from 'k6/ws';
import { sleep, check, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// Custom metrics
const httpReqDuration = new Trend('http_req_duration', true);
const syncErrorRate = new Rate('sync_error_rate');
const wsConnections = new Counter('ws_connections');
const wsMessages = new Counter('ws_messages');
const wsConnectErrors = new Rate('ws_connect_errors');

export const options = {
  scenarios: {
    combined_load: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 100 },   // Warm-up
        { duration: '1m', target: 200 },    // Medium load
        { duration: '30s', target: 0 },     // Cool-down
      ],
      gracefulRampDown: '10s',
    },
  },

  thresholds: {
    http_req_duration: ['p(95)<500'],
    sync_error_rate: ['rate<0.05'],
    ws_connect_errors: ['rate<0.05'],
  },
};

const BASE = __ENV.BASE_URL || 'http://localhost:3000';
const WS_URL = __ENV.WS_URL || 'ws://localhost:3001';
const SITE_ID = __ENV.SITE_ID || 'cmnngqini009fvnjo5ccymjmm';
const SESSION_TOKEN = __ENV.SESSION_TOKEN || '';

const pileGrades = ['grade-1', 'grade-2', 'grade-3'];

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
    drillings: [],
    downtimes: [],
  };
}

export default function runScenario() {
  const vuId = __VU;
  const iteration = __ITER;
  const headers = {
    'Content-Type': 'application/json',
    'Cookie': `pt-session=${SESSION_TOKEN}`,
  };

  // ---- HTTP: Push Sync ----
  group('http_sync', function () {
    const start = Date.now();

    const operations = [{
      id: `op-${vuId}-${iteration}-${Date.now()}`,
      type: 'REPORT_CREATE',
      entity: 'report',
      entityId: `report-${vuId}-${iteration}-${Date.now()}`,
      payload: generateReportPayload(vuId, iteration),
      localTimestamp: Date.now(),
    }];

    const res = http.post(`${BASE}/api/sync`, JSON.stringify({ operations }), { headers });
    httpReqDuration.add(Date.now() - start);

    const ok = check(res, { 'sync 200': (r) => r.status === 200 });
    syncErrorRate.add(!ok);
  });

  sleep(0.5 + Math.random() * 1);

  // ---- HTTP: Pull Sync ----
  group('http_pull', function () {
    const since = Date.now() - 60000;
    const res = http.get(`${BASE}/api/sync/updates?since=${since}`, { headers });
    check(res, { 'pull 200': (r) => r.status === 200 });
  });

  sleep(0.5 + Math.random() * 0.5);

  // ---- WebSocket Connection ----
  group('ws_connection', function () {
    const wsRes = ws.connect(WS_URL, {}, function (socket) {
      socket.on('open', () => {
        wsConnections.add(1);
        socket.send(JSON.stringify({ type: 'ping' }));
      });

      socket.on('message', (msg) => {
        wsMessages.add(1);
      });

      socket.on('close', () => {});
      socket.on('error', () => {});

      socket.setTimeout(() => { socket.close(); }, 10000);
    });

    const connected = check(wsRes, { 'ws 101': (r) => r && r.status === 101 });
    wsConnectErrors.add(!connected);
  });

  sleep(1 + Math.random());
}
