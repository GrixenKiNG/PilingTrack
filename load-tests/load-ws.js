/**
 * k6 WebSocket Load Test — PilingTrack Realtime
 *
 * Simulates 1000-1500 concurrent WS connections:
 * - Connect + authenticate
 * - Subscribe to channels
 * - Heartbeat (ping/pong)
 * - Measure message delivery latency
 *
 * Run:
 *   k6 run --out json=results-ws.json load-ws.js
 */

import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Counter, Trend, Rate } from 'k6/metrics';

// Custom metrics
const wsConnections = new Counter('ws_connections');
const wsMessages = new Counter('ws_messages_received');
const wsMessageLatency = new Trend('ws_message_latency_ms', true);
const wsConnectErrors = new Rate('ws_connect_errors');
const wsReconnects = new Counter('ws_reconnects');

// ============================================================
// Options
// ============================================================

export const options = {
  scenarios: {
    ws_users: {
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

  thresholds: {
    ws_connect_errors: ['rate<0.05'],          // < 5% connect errors
    ws_message_latency_ms: ['p(95)<500'],       // p95 delivery < 500ms
  },
};

// ============================================================
// Config
// ============================================================

const WS_URL = __ENV.WS_URL || 'ws://localhost:3001';
const TENANT_ID = __ENV.TENANT_ID || 'default';
const USER_ID_BASE = `user-${Date.now()}`;

// ============================================================
// Main scenario
// ============================================================

export default function () {
  const vuId = __VU;
  const userId = `${USER_ID_BASE}-${vuId}`;

  // Build URL with auth query params (adjust to your auth method)
  // If using cookie/session — k6 handles it via http.cookies
  // If using token — pass as query param or header
  const url = `${WS_URL}?tenant=${TENANT_ID}`;

  const res = ws.connect(url, {}, function (socket) {
    let messageCount = 0;
    let firstMessageTime = null;

    socket.on('open', () => {
      wsConnections.add(1);

      // Subscribe to tenant channel
      socket.send(JSON.stringify({
        type: 'subscribe',
        channel: `tenant:${TENANT_ID}`,
      }));

      // Send initial ping
      socket.send(JSON.stringify({ type: 'ping' }));
    });

    socket.on('message', (msg) => {
      wsMessages.add(1);
      messageCount++;

      try {
        const data = JSON.parse(msg);

        // Track welcome message latency
        if (data.type === 'welcome' && !firstMessageTime) {
          firstMessageTime = Date.now();
          const latency = data.serverTs ? Date.now() - data.serverTs : 0;
          wsMessageLatency.add(latency);
        }

        // Track pong latency
        if (data.type === 'pong') {
          const latency = data.serverTs ? Date.now() - data.serverTs : 0;
          wsMessageLatency.add(latency);
        }

        // Track realtime event delivery latency
        if (data.type === 'event' && data.ts) {
          const deliveryLatency = Date.now() - data.ts;
          wsMessageLatency.add(deliveryLatency);
        }
      } catch (e) {
        // Binary or non-JSON message — skip
      }

      // Periodic heartbeat
      if (messageCount % 10 === 0) {
        socket.send(JSON.stringify({ type: 'ping' }));
      }
    });

    socket.on('close', () => {
      // Connection closed — will be reconnected by k6 VU loop
    });

    socket.on('error', (err) => {
      // Error logged by k6
    });

    // Auto-close after 60 seconds (VU will reconnect)
    socket.setTimeout(() => {
      socket.close();
    }, 60000);
  });

  // Check connection success
  const connected = check(res, {
    'ws connected': (r) => r && r.status === 101,
  });

  wsConnectErrors.add(!connected);

  if (!connected) {
    wsReconnects.add(1);
  }

  // Sleep before reconnect
  sleep(1 + Math.random() * 2);
}

// ============================================================
// Setup
// ============================================================

export function setup() {
  console.log(`Starting WS load test against ${WS_URL}`);
  console.log(`Target: 1000 WS connections, tenant: ${TENANT_ID}`);
  return { startTime: Date.now() };
}

export function teardown(data) {
  const duration = Date.now() - data.startTime;
  console.log(`WS load test completed. Duration: ${Math.round(duration / 1000)}s`);
}
