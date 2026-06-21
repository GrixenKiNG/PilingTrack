/**
 * k6 WebSocket Load Test — PilingTrack (Single Instance, no Redis)
 *
 * Tests WS connection handling, heartbeat, and message delivery
 * without Redis Pub/Sub (single-instance mode).
 *
 * Run:
 *   k6 run load-tests/load-ws-quick.js --vus 200 --duration 60s
 */

import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Counter, Trend, Rate } from 'k6/metrics';

const wsConnections = new Counter('ws_connections');
const wsMessages = new Counter('ws_messages_received');
const wsConnectErrors = new Rate('ws_connect_errors');

export const options = {
  scenarios: {
    ws_test: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 200 },
        { duration: '30s', target: 200 },
        { duration: '10s', target: 0 },
      ],
      gracefulRampDown: '5s',
    },
  },

  thresholds: {
    ws_connect_errors: ['rate<0.10'],
  },
};

const WS_URL = __ENV.WS_URL || 'ws://localhost:3001';

export default function runScenario() {
  const vuId = __VU;
  const url = `${WS_URL}`;

  const res = ws.connect(url, {}, function (socket) {
    let msgCount = 0;

    socket.on('open', () => {
      wsConnections.add(1);

      // Send ping to test heartbeat
      socket.send(JSON.stringify({ type: 'ping' }));
    });

    socket.on('message', (msg) => {
      wsMessages.add(1);
      msgCount++;

      try {
        const data = JSON.parse(msg);

        // Respond to pong
        if (data.type === 'pong') {
          // Connection is alive
        }

        // Send another ping after 10 messages
        if (msgCount % 10 === 0) {
          socket.send(JSON.stringify({ type: 'ping' }));
        }
      } catch (e) {
        // Non-JSON message — skip
      }
    });

    socket.on('close', () => {
      // Will reconnect via VU loop
    });

    socket.on('error', () => {
      // Error handled by k6
    });

    // Close after 30s to force reconnection
    socket.setTimeout(() => {
      socket.close();
    }, 30000);
  });

  const connected = check(res, {
    'ws connected': (r) => r && r.status === 101,
  });

  wsConnectErrors.add(!connected);

  sleep(0.5 + Math.random());
}
