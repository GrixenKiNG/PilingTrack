/**
 * GET /api/health — behavioural tests.
 *
 * This route is the Dockerfile HEALTHCHECK target (`wget --spider`) and the
 * deploy gate (runbook 008 reads `version`), so two contracts MUST hold:
 *   - the usual run answers status/version/uptime with the mapped code;
 *   - an exception while producing the verdict never escapes as Next's
 *     empty-body 500 — it answers 503 with a parseable body (audit R60 #3).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const { getHealthMock, loggerErrorMock } = vi.hoisted(() => ({
  getHealthMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock('@/core/observability/health-checks', () => ({
  getHealth: getHealthMock,
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: loggerErrorMock, info: vi.fn(), warn: vi.fn(), debug: vi.fn(), time: vi.fn() },
}));

import { GET } from '../route';

function req(): NextRequest {
  return new NextRequest('http://localhost/api/health');
}

function makeHealth(overrides: Record<string, unknown> = {}) {
  return {
    status: 'ok' as const,
    timestamp: '2026-09-30T12:00:00.000Z',
    uptime: 123.4,
    version: '2cb4d6cb',
    database_provider: 'postgresql',
    checks: {},
    ...overrides,
  };
}

describe('GET /api/health', () => {
  beforeEach(() => {
    getHealthMock.mockReset();
    loggerErrorMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('обычный случай: 200 и прежний контракт status/version/uptime', async () => {
    getHealthMock.mockResolvedValue(makeHealth({ version: '2cb4d6cb' }));

    const res = await GET(req());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual({ status: 'ok', version: '2cb4d6cb', uptime: 123.4 });
  });

  it('degraded остаётся 200 (вторичные проверки не валят пробу)', async () => {
    getHealthMock.mockResolvedValue(makeHealth({ status: 'degraded' }));

    const res = await GET(req());
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('degraded');
  });

  it('unhealthy отдаёт 503 с непустым телом', async () => {
    getHealthMock.mockResolvedValue(makeHealth({ status: 'unhealthy' }));

    const res = await GET(req());
    expect(res.status).toBe(503);

    const body = await res.json();
    expect(body.status).toBe('unhealthy');
    expect(body.version).toBe('2cb4d6cb');
    expect(typeof body.uptime).toBe('number');
  });

  it('исключение: 503, тело не пустое, поля контракта на месте, ошибка в логе', async () => {
    getHealthMock.mockRejectedValue(new Error('version read failed'));

    const res = await GET(req());
    expect(res.status).toBe(503);

    // Не Next'овский пустой 500: тело обязано парситься.
    const raw = await res.text();
    expect(raw.length).toBeGreaterThan(0);
    const body = JSON.parse(raw) as Record<string, unknown>;
    expect(body.status).toBe('unhealthy');
    expect(typeof body.version).toBe('string');
    expect((body.version as string).length).toBeGreaterThan(0);
    expect(typeof body.uptime).toBe('number');

    expect(loggerErrorMock).toHaveBeenCalledTimes(1);
    expect(loggerErrorMock.mock.calls[0][0]).toMatch(/health/i);
  });

  it('исключение в не-Error объекте тоже не выходит наружу', async () => {
    getHealthMock.mockRejectedValue('boom');

    const res = await GET(req());
    expect(res.status).toBe(503);
    expect((await res.json()).status).toBe('unhealthy');
  });
});
