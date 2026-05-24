/**
 * GET /api/health/deep — behavioural tests.
 *
 * UptimeRobot polls this. The two contracts that MUST hold:
 *   - HTTP 200 when overall status is healthy or degraded
 *   - HTTP 503 when overall status is unhealthy
 *   - No internal detail leaks (error messages, latencies)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { getFreshStatusMock } = vi.hoisted(() => ({
  getFreshStatusMock: vi.fn(),
}));

vi.mock('@/core/observability/health-tracker', () => ({
  getFreshStatus: getFreshStatusMock,
}));

import { GET } from '../route';

function req(): NextRequest {
  return new NextRequest('http://localhost/api/health/deep');
}

function makeStatus(overrides: Record<string, unknown> = {}) {
  return {
    status: 'healthy' as const,
    timestamp: '2026-05-24T13:00:00.000Z',
    version: '2.4.1',
    components: {
      database: { status: 'up', latencyMs: 5 },
      redis: { status: 'up', latencyMs: 1 },
      outbox: { status: 'ok', pendingCount: 0 },
      workers: { status: 'running' },
      storage: { status: 'up', provider: 's3' },
      websocket: { status: 'up', connections: 3 },
      backup: { status: 'up' },
    },
    metrics: {
      uptime: 100,
      memoryUsage: {} as NodeJS.MemoryUsage,
      outboxPending: 0,
      dlqPending: 0,
      activeWsConnections: 3,
    },
    ...overrides,
  };
}

describe('GET /api/health/deep', () => {
  beforeEach(() => {
    getFreshStatusMock.mockReset();
  });

  it('returns 200 when overall status is healthy', async () => {
    getFreshStatusMock.mockResolvedValue(makeStatus());
    const res = await GET(req());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('healthy');
    expect(body.components).toEqual({
      database: 'ok',
      redis: 'ok',
      storage: 'ok',
      websocket: 'ok',
    });
  });

  it('returns 200 when overall status is degraded (still serving)', async () => {
    getFreshStatusMock.mockResolvedValue(
      makeStatus({
        status: 'degraded',
        components: {
          database: { status: 'slow', latencyMs: 800 },
          redis: { status: 'up' },
          outbox: { status: 'ok', pendingCount: 0 },
          workers: { status: 'running' },
          storage: { status: 'up', provider: 's3' },
          websocket: { status: 'up' },
          backup: { status: 'up' },
        },
      }),
    );

    const res = await GET(req());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('degraded');
    // 'slow' is not 'up' → mapped to 'down' in the public summary.
    // UptimeRobot still gets 200 because overall is degraded, not unhealthy.
    expect(body.components.database).toBe('down');
  });

  it('returns 503 when overall status is unhealthy', async () => {
    getFreshStatusMock.mockResolvedValue(
      makeStatus({
        status: 'unhealthy',
        components: {
          database: { status: 'down' },
          redis: { status: 'up' },
          outbox: { status: 'ok', pendingCount: 0 },
          workers: { status: 'running' },
          storage: { status: 'up', provider: 's3' },
          websocket: { status: 'up' },
          backup: { status: 'up' },
        },
      }),
    );

    const res = await GET(req());
    expect(res.status).toBe(503);

    const body = await res.json();
    expect(body.status).toBe('unhealthy');
    expect(body.components.database).toBe('down');
  });

  it('does not leak internal detail (latencies, error messages, version)', async () => {
    getFreshStatusMock.mockResolvedValue(makeStatus());
    const res = await GET(req());
    const body = await res.json();

    // Sensitive fields from the admin-only /api/system/status response
    // must not appear in the public deep-health body.
    expect(body).not.toHaveProperty('version');
    expect(body).not.toHaveProperty('metrics');
    expect(body.components.database).not.toHaveProperty('latencyMs');
    expect(JSON.stringify(body)).not.toMatch(/error/i);
  });

  it('sets Cache-Control: no-store so monitors always see fresh status', async () => {
    getFreshStatusMock.mockResolvedValue(makeStatus());
    const res = await GET(req());
    expect(res.headers.get('Cache-Control')).toMatch(/no-store/);
  });
});
