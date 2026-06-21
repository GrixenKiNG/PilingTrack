/**
 * k6 HTTP Load Test — PilingTrack
 *
 * Simulates 1000 concurrent operators:
 * - POST /api/sync/v2 (versioned sync with conflict resolution)
 * - GET /api/sync/updates (pull sync)
 *
 * Target: 1000 VUs, 300-800 RPS peak
 *
 * Run:
 *   k6 run --out json=results-http.json load-http.js
 *   k6 run --out json=results-http.json --vus 1000 --duration 10m load-http.js
 */

import http from 'k6/http';
import { sleep, check, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const syncErrorRate = new Rate('sync_error_rate');
const pullSyncErrorRate = new Rate('pull_sync_error_rate');
const syncLatency = new Trend('sync_latency_ms');
const conflictRate = new Rate('conflict_rate');

// ============================================================
// Options
// ============================================================

export const options = {
  scenarios: {
    // Ramp-up to 1000 concurrent operators
    operators: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 200 },   // Warm-up
        { duration: '3m', target: 500 },   // Medium load
        { duration: '3m', target: 1000 },  // Peak load
        { duration: '5m', target: 1000 },  // Sustained peak
        { duration: '2m', target: 0 },     // Cool-down
      ],
      gracefulRampDown: '30s',
    },
  },

  // SLO thresholds
  thresholds: {
    http_req_duration: [
      'p(50)<200',   // Median < 200ms (sync v2 is heavier)
      'p(90)<500',   // p90 < 500ms
      'p(95)<800',   // p95 < 800ms
      'p(99)<1500',  // p99 < 1.5s
    ],
    http_req_failed: ['rate<0.01'],          // Error rate < 1%
    sync_error_rate: ['rate<0.01'],          // Sync errors < 1%
    pull_sync_error_rate: ['rate<0.02'],     // Pull sync errors < 2%
    conflict_rate: ['rate<0.1'],             // Conflicts < 10%
  },

  // Global settings
  noConnectionReuse: false,
  userAgent: 'k6-pilingtrack-loadtest/2.0',
};

// ============================================================
// Config
// ============================================================

const BASE = __ENV.BASE_URL || 'http://localhost:3000';
const TENANT_ID = __ENV.TENANT_ID || 'default';

// Shared test data
const pileGrades = ['grade-1', 'grade-2', 'grade-3'];
const drillingTypes = ['type-1', 'type-2'];
const downtimeReasons = ['reason-1', 'reason-2', 'reason-3'];

// ============================================================
// Helpers
// ============================================================

function generateReportPayload(vuId, iteration) {
  const reportId = `report-${vuId}-${iteration}-${Date.now()}`;
  const shiftTypes = ['day', 'night'];
  const shiftType = shiftTypes[Math.floor(Math.random() * 2)];

  return {
    id: reportId,
    tenantId: TENANT_ID,
    userId: `user-${vuId}`,
    siteId: `site-${(vuId % 5) + 1}`,
    date: new Date().toISOString().split('T')[0],
    shiftType: shiftType,
    status: Math.random() > 0.3 ? 'submitted' : 'draft',
    piles: [
      {
        pileGradeId: pileGrades[vuId % pileGrades.length],
        count: Math.floor(Math.random() * 20) + 1,
      },
    ],
    drillings: Math.random() > 0.5 ? [
      {
        typeId: drillingTypes[vuId % drillingTypes.length],
        meters: Math.floor(Math.random() * 50) + 10,
      },
    ] : [],
    downtimes: Math.random() > 0.7 ? [
      {
        reasonId: downtimeReasons[vuId % downtimeReasons.length],
        duration: Math.floor(Math.random() * 120) + 5,
        comment: null,
      },
    ] : [],
  };
}

function generateSyncV2Request(vuId, iteration) {
  const changes = [];
  const numOps = Math.floor(Math.random() * 3) + 1; // 1-3 operations per batch

  for (let i = 0; i < numOps; i++) {
    changes.push({
      entity: 'report',
      op: 'upsert',
      data: generateReportPayload(vuId, iteration + i),
      baseVersion: Math.floor(Math.random() * 3), // Simulate version tracking
      opId: `op-${vuId}-${iteration}-${i}-${Date.now()}`,
    });
  }

  return {
    deviceId: `device-${vuId}`,
    tenantId: TENANT_ID,
    userId: `user-${vuId}`,
    lastSyncAt: new Date(Date.now() - 300000).toISOString(), // 5 min ago
    changes,
  };
}

// ============================================================
// Main scenario
// ============================================================

export default function runScenario() {
  const vuId = __VU;
  const iteration = __ITER;

  const headers = { 'Content-Type': 'application/json' };

  // ---- Group 1: Push sync v2 (versioned sync) ----
  group('sync_v2_push', function () {
    const payload = JSON.stringify(generateSyncV2Request(vuId, iteration));

    const res = http.post(`${BASE}/api/sync/v2`, payload, { headers });

    syncLatency.add(res.timings.duration);

    const ok = check(res, {
      'sync v2 status 200': (r) => r.status === 200,
      'sync v2 has serverChanges': (r) => {
        try {
          const body = r.json();
          return body.serverChanges && Array.isArray(body.serverChanges);
        } catch { return false; }
      },
      'sync v2 has stats': (r) => {
        try {
          const body = r.json();
          return body.stats && typeof body.stats.applied === 'number';
        } catch { return false; }
      },
    });

    // Track conflicts
    try {
      const body = res.json();
      if (body.conflicts && body.conflicts.length > 0) {
        conflictRate.add(true);
      } else {
        conflictRate.add(false);
      }
    } catch { /* ignore */ }

    syncErrorRate.add(!ok);
  });

  // Variable sleep: 2-8 seconds between sync batches
  sleep(2 + Math.random() * 6);

  // ---- Group 2: Pull sync (get updates) ----
  group('pull_sync', function () {
    const since = new Date(Date.now() - 300000).toISOString();

    const res = http.get(
      `${BASE}/api/sync/updates?since=${since}&tenantId=${TENANT_ID}`,
      { headers }
    );

    const ok = check(res, {
      'pull status 200': (r) => r.status === 200,
      'pull has cursor': (r) => {
        try {
          const body = r.json();
          return body.cursor > 0;
        } catch { return false; }
      },
    });

    pullSyncErrorRate.add(!ok);
  });

  // Variable sleep: 3-10 seconds between pulls
  sleep(3 + Math.random() * 7);
}

// ============================================================
// Setup (run once before test)
// ============================================================

export function setup() {
  console.log(`Starting load test against ${BASE}`);
  console.log(`Target: 1000 VUs, tenant: ${TENANT_ID}`);
  return { startTime: Date.now() };
}

// ============================================================
// Teardown (run once after test)
// ============================================================

export function teardown(data) {
  const duration = Date.now() - data.startTime;
  console.log(`Load test completed. Duration: ${Math.round(duration / 1000)}s`);
}
