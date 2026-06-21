/**
 * k6 Login Test — PilingTrack
 *
 * Tests authentication endpoint under load.
 * Measures: login latency, token generation, rate limiting.
 *
 * Usage:
 *   k6 run --vus 50 --duration 2m performance/k6/login.test.js
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const loginLatency = new Trend('login_latency', true);
const loginErrors = new Rate('login_errors');

// Load test configuration
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

// Test credentials (from seed data)
const CREDENTIALS = [
  { email: 'admin@piling.ru', password: __ENV.ADMIN_PASSWORD || '1234' },
  { email: 'dispatch@piling.ru', password: __ENV.DISPATCH_PASSWORD || '2222' },
  { email: 'operator@piling.ru', password: __ENV.OPERATOR_PASSWORD || '0000' },
  { email: 'sas02@rambler.ru', password: __ENV.OPERATOR2_PASSWORD || '1111' },
  { email: 'helper@piling.ru', password: __ENV.ASSISTANT_PASSWORD || '3333' },
];

export const options = {
  stages: [
    { duration: '30s', target: 10 },
    { duration: '1m', target: 50 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    login_latency: ['p(95)<300', 'p(99)<500'],
    login_errors: ['rate<0.05'],
    http_req_duration: ['p(95)<300'],
    http_req_failed: ['rate<0.05'],
  },
};

export function setup() {
  // Health check
  const healthRes = http.get(`${BASE_URL}/api/health`);
  check(healthRes, {
    'health check passes': (r) => r.status === 200,
  });

  return { startTime: Date.now() };
}

export default function runScenario() {
  const creds = CREDENTIALS[Math.floor(Math.random() * CREDENTIALS.length)];

  group('Login', () => {
    const loginRes = http.post(
      `${BASE_URL}/api/auth/login`,
      JSON.stringify({
        email: creds.email,
        password: creds.password,
      }),
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const success = check(loginRes, {
      'login status 200': (r) => r.status === 200,
      'login returns token': (r) => {
        try {
          const body = JSON.parse(r.body);
          return !!body.accessToken || !!body.setCookie;
        } catch {
          return false;
        }
      },
      'login latency < 300ms': (r) => r.timings.duration < 300,
    });

    loginLatency.add(loginRes.timings.duration);
    loginErrors.add(!success);

    if (success) {
      // Validate auth by calling a protected endpoint
      const meRes = http.get(`${BASE_URL}/api/auth/me`, {
        cookies: loginRes.cookies,
      });

      check(meRes, {
        'auth me status 200': (r) => r.status === 200,
      });
    }
  });

  sleep(1);
}

export function handleSummary(data) {
  return {
    'performance/results/login-summary.json': JSON.stringify(data),
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
  };
}

function textSummary(data, options) {
  const { indent = '', enableColors = true } = options;
  let output = '\nLogin Test Summary:\n';
  output += `${indent}Duration: ${data.state.testRunDurationMs / 1000}s\n`;
  output += `${indent}Iterations: ${data.metrics.iterations.values.count}\n`;
  output += `${indent}Login p95: ${data.metrics.login_latency?.values['p(95)']?.toFixed(0) || 'N/A'}ms\n`;
  output += `${indent}Login errors: ${((data.metrics.login_errors?.values.rate || 0) * 100).toFixed(2)}%\n`;
  return output;
}
