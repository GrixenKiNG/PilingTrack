import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { getReadinessMock } = vi.hoisted(() => ({
  getReadinessMock: vi.fn(),
}));

vi.mock('@/core/observability/health-checks', () => ({
  getReadiness: getReadinessMock,
}));

import { GET as readyGET } from '../route';
import { GET as readinessGET } from '../../readiness/route';

const request = () => new NextRequest('http://localhost/api/ready');

describe('public readiness probes must not leak internal details', () => {
  it('strips details from /api/ready checks while keeping ready/status/latencyMs', async () => {
    getReadinessMock.mockResolvedValue({
      status: 'not_ready',
      checks: {
        database: { name: 'database', status: 'fail', latencyMs: 5, details: { error: 'Could not connect to db host=secret' } },
        environment: { name: 'environment', status: 'warn', details: { missing: ['SESSION_SECRET'] } },
      },
    });

    const response = await readyGET(request());
    expect(response.status).toBe(503);

    const body = await response.json();
    expect(body.ready).toBe(false);
    expect(body.status).toBe('not_ready');
    expect(body.checks).toEqual({
      database: { name: 'database', status: 'fail', latencyMs: 5 },
      environment: { name: 'environment', status: 'warn' },
    });
    expect(body.checks.database.details).toBeUndefined();
    expect(body.checks.environment.details).toBeUndefined();
  });

  it('keeps 200 + ready:true and strips details from the deprecated /api/readiness alias', async () => {
    getReadinessMock.mockResolvedValue({
      status: 'ready',
      checks: {
        database: { name: 'database', status: 'pass', details: { error: 'hidden' } },
        environment: { name: 'environment', status: 'pass', details: { missing: ['ANY_SECRET'] } },
      },
    });

    const response = await readinessGET(request());
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.status).toBe('ready');
    expect(body.checks).toEqual({
      database: { name: 'database', status: 'pass' },
      environment: { name: 'environment', status: 'pass' },
    });
    expect(body.checks.database.details).toBeUndefined();
    expect(body.checks.environment.details).toBeUndefined();
  });
});