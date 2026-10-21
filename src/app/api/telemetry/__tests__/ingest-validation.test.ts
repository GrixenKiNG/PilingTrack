/**
 * /api/telemetry/ingest отклоняет неконечные числа и поля неверного типа до записи
 * (разбор Codex N21X3, п.1: Infinity, NaN из координат, "unit": 42, плохая дата).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  createMany: vi.fn(),
  check: vi.fn(),
  authenticate: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ db: { telemetryRecord: { createMany: mocks.createMany } } }));
vi.mock('@/modules/telemetry', () => ({ authenticateDeviceByKey: mocks.authenticate }));
vi.mock('@/lib/rate-limiter', () => ({
  rateLimiter: { check: mocks.check },
  getRateLimitIdentifier: () => 'test-device',
}));
vi.mock('@/core/security/tenant-context', () => ({ setRequestTenantId: vi.fn() }));
vi.mock('@/core/api-wrapper', () => ({
  withApi: (handler: unknown) => handler,
  readJsonBody: (request: Request) => request.json(),
}));
vi.mock('@/lib/request-context', () => ({
  getRequestId: () => 'test',
  createJsonResponse: (body: unknown, init: ResponseInit) => Response.json(body, init),
}));

import { PATCH, POST } from '../ingest/route';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.check.mockResolvedValue({ allowed: true });
  mocks.createMany.mockResolvedValue({ count: 1 });
  mocks.authenticate.mockResolvedValue({
    deviceKeyId: 'key-a',
    tenantId: 'tenant-a',
    equipmentId: 'equipment-a',
    siteId: null,
  });
});

function send(method: 'POST' | 'PATCH', json: string) {
  const handler = method === 'POST' ? POST : PATCH;
  return handler(new NextRequest('http://localhost/api/telemetry/ingest', {
    method,
    headers: { 'content-type': 'application/json', 'x-device-key': 'device-key' },
    body: method === 'PATCH' ? `[${json}]` : json,
  }));
}

describe.each(['POST', 'PATCH'] as const)('%s ingest', (method) => {
  it.each([
    '{"type":"pressure","value":1e400}',
    '{"type":"pressure","value":12,"latitude":"abc"}',
    '{"type":"pressure","value":12,"latitude":""}',
    '{"type":"pressure","value":12,"longitude":false}',
    '{"type":"pressure","value":12,"unit":42}',
    '{"type":"pressure","value":12,"metadata":42}',
    '{"type":"pressure","value":12,"timestamp":"bad"}',
  ])('отвечает 400 и ничего не пишет: %s', async (json) => {
    const response = await send(method, json);

    expect(response.status).toBe(400);
    expect(mocks.createMany).not.toHaveBeenCalled();
  });

  it('принимает корректную запись', async () => {
    const response = await send(
      method,
      '{"type":"equipment_gps","value":0,"latitude":55.7,"longitude":37.6,"unit":"deg","metadata":{"k":1},"timestamp":"2026-10-21T10:00:00Z"}',
    );

    expect(response.status).toBe(202);
    expect(mocks.createMany).toHaveBeenCalledTimes(1);
  });
});
