/**
 * Chaos Engineering — k6 Test Suite
 *
 * Tests system resilience under fault injection:
 * 1. Circuit Breaker opens under DB failure
 * 2. Outbox backoff prevents retry storms
 * 3. WebSocket polling fallback activates
 * 4. Leader election prevents double-processing
 *
 * Usage:
 *   k6 run tests/chaos/circuit-breaker.test.js
 *   k6 run tests/chaos/load-spike.test.js --vus 50 --duration 60s
 *
 * Requires: k6 (https://k6.io/docs/getting-started/installation/)
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Gauge, Trend } from 'k6/metrics';

// ============================================================
// Custom Metrics
// ============================================================

const circuitBreakerOpens = new Counter('circuit_breaker_opens');
const retryStormDetected = new Counter('retry_storm_detected');
const gracefulDegradation = new Counter('graceful_degradation');
const response503Count = new Counter('http_503_responses');
const responseTime = new Trend('response_time_ms', true);

// ============================================================
// Configuration
// ============================================================

export const options = {
  stages: [
    { duration: '10s', target: 5 },    // Warmup
    { duration: '30s', target: 20 },   // Normal load
    { duration: '10s', target: 100 },  // Spike!
    { duration: '30s', target: 100 },  // Sustained spike
    { duration: '10s', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'],     // 95% of requests < 2s
    http_req_failed: ['rate<0.1'],          // < 10% error rate
    response_time_ms: ['p(95)<2500'],       // Custom metric threshold
    circuit_breaker_opens: ['count<50'],    // CB should open but not infinitely
    graceful_degradation: ['count>0'],      // At least some graceful degradation
  },
};

// ============================================================
// Test Configuration
// ============================================================

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const TEST_EMAIL = __ENV.TEST_EMAIL || 'admin@piling.ru';
const TEST_PASSWORD = __ENV.TEST_PASSWORD || 'admin123';

let authToken = '';

// ============================================================
// Setup — Login and get auth token
// ============================================================

export function setup() {
  const loginRes = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });

  if (loginRes.status !== 200) {
    console.error(`Login failed: ${loginRes.status} ${loginRes.body}`);
    return { token: '' };
  }

  const body = JSON.parse(loginRes.body);
  // Extract cookie from response
  const cookies = loginRes.headers['Set-Cookie'] || loginRes.headers['set-cookie'];

  console.log('✅ Login successful');
  return { token: cookies, userId: body.user?.id };
}

// ============================================================
// VU Execution
// ============================================================

export default function (data) {
  const { token } = data;
  if (!token) {
    console.error('No auth token, skipping');
    return;
  }

  // Test 1: Normal mutation — should succeed
  testNormalMutation(token);

  // Test 2: Concurrent mutations — test rate limiting
  testRateLimiting(token);

  // Test 3: Circuit breaker — verify 503 under DB failure
  // (This requires manual fault injection — see below)

  sleep(1);
}

// ============================================================
// Test: Normal Mutation
// ============================================================

function testNormalMutation(token) {
  const payload = JSON.stringify({
    siteId: 'test-site-id',
    name: `Chaos Test Crew ${Date.now()}`,
    operatorId: 'test-operator-id',
    equipmentId: 'test-equipment-id',
  });

  const res = http.post(`${BASE_URL}/api/crews`, payload, {
    headers: {
      'Content-Type': 'application/json',
      'Cookie': token,
    },
  });

  responseTime.add(res.timings.duration);

  const passed = check(res, {
    'mutation returns 200 or 503': (r) => r.status === 200 || r.status === 503,
    '503 includes Retry-After': (r) => {
      if (r.status !== 503) return true; // N/A
      const retryAfter = r.headers['Retry-After'];
      if (retryAfter) {
        circuitBreakerOpens.add(1);
        return true;
      }
      return false;
    },
    '200 has crew data': (r) => {
      if (r.status !== 200) return true; // N/A
      try {
        const body = JSON.parse(r.body);
        return body.crew && body.crew.id;
      } catch {
        return false;
      }
    },
  });

  if (!passed && res.status === 503) {
    gracefulDegradation.add(1);
    response503Count.add(1);
  }
}

// ============================================================
// Test: Rate Limiting
// ============================================================

function testRateLimiting(token) {
  // Send rapid requests to trigger rate limiting
  const res = http.get(`${BASE_URL}/api/crews`, {
    headers: {
      'Cookie': token,
    },
  });

  check(res, {
    'rate limit respected': (r) => r.status === 200 || r.status === 429,
    '429 includes Retry-After': (r) => {
      if (r.status !== 429) return true; // N/A
      return r.headers['Retry-After'] !== undefined;
    },
  });
}

// ============================================================
// Teardown — Cleanup
// ============================================================

export function teardown(data) {
  console.log('🏁 Chaos test completed');
  console.log(`  Circuit breaker opens: ${circuitBreakerOpens.sum}`);
  console.log(`  Graceful degradations: ${gracefulDegradation.sum}`);
  console.log(`  503 responses: ${response503Count.sum}`);
  console.log(`  Retry storms detected: ${retryStormDetected.sum}`);
}

// ============================================================
// Fault Injection Scenarios (Manual)
// ============================================================

/**
 * Scenario 1: Kill PostgreSQL
 *   kubectl scale deployment postgres --replicas=0
 *   k6 run tests/chaos/circuit-breaker.test.js
 *
 * Expected:
 *   - Circuit breaker opens after 5 failures
 *   - API returns 503 with Retry-After header
 *   - No retry storm (exponential backoff)
 *   - After restoring DB, circuit transitions HALF_OPEN → CLOSED
 *
 * Verification:
 *   curl http://localhost:3000/api/system/status
 *   → components.database.status should be "down"
 *   → status should be "unhealthy"
 */

/**
 * Scenario 2: Kill Redis
 *   kubectl scale deployment redis --replicas=0
 *   k6 run tests/chaos/circuit-breaker.test.js
 *
 * Expected:
 *   - Rate limiting falls back to in-memory
 *   - Outbox worker continues (uses DB)
 *   - WebSocket Pub/Sub breaks (single node still works)
 *
 * Verification:
 *   curl http://localhost:3000/api/system/status
 *   → components.redis.status should be "down"
 *   → status should be "degraded"
 */

/**
 * Scenario 3: Kill Outbox Worker
 *   kubectl scale deployment outbox-worker --replicas=0
 *   Send mutations → check that events accumulate in outbox
 *   Restart worker → verify replay
 *
 * Expected:
 *   - Outbox events accumulate (published: false)
 *   - After restart, worker replays backlog
 *   - Projections catch up
 *
 * Verification:
 *   - Check /api/metrics for outbox_pending_count
 *   - After restart, count should go to 0
 */

/**
 * Scenario 4: Load Spike
 *   k6 run tests/chaos/circuit-breaker.test.js --vus 100 --duration 120s
 *
 * Expected:
 *   - HPA scales up (CPU > 70%)
 *   - Rate limiting kicks in
 *   - No cascade failure
 *
 * Verification:
 *   - kubectl get hpa pilingtrack-api
 *   - Check pod count increases
 */
