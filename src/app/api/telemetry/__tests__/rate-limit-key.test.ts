/**
 * F-RL-TELEMETRY-KEY (отчёт R80, находка 1): ручной лимит телеметрии ключевался
 * голым IP — `rl:<ip>` и `rl:blocked:<ip>` были общими с публичной формой заявок
 * ORION (порог 5/10 мин, блок 30 мин), поэтому поток заявок с одного адреса
 * закрывал приём телеметрии и наоборот. Маршруты телеметрии обязаны передавать
 * в `rateLimiter.check` ключ с префиксом `telemetry:`; у /api/telemetry/ingest
 * порог свой (500/60 с против 1000/60 с), поэтому у него свой префикс.
 *
 * Проверка идёт по факту вызова: лимитер возвращает «нельзя», и маршрут
 * отвечает 429 до проверки сессии — этого достаточно, чтобы увидеть ключ.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { rateLimiterCheckMock } = vi.hoisted(() => ({
  rateLimiterCheckMock: vi.fn(async (_identifier: string, _config: unknown) => ({
    allowed: false,
    remaining: 0,
    retryAfter: 60,
  })),
}));

vi.mock('@/lib/rate-limiter', () => ({
  rateLimiter: { check: rateLimiterCheckMock },
  getRateLimitIdentifier: () => '203.0.113.7',
}));
vi.mock('@/core/api-wrapper', () => ({
  withApi: (handler: unknown) => handler,
  readJsonBody: (request: Request) => request.json(),
}));
vi.mock('@/lib/csrf-protection', () => ({ withCsrf: () => null }));
vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn(async () => ({ user: null, error: null })) }));
vi.mock('@/lib/tenant', () => ({ requireTenantId: () => 'tenant-a' }));
vi.mock('@/services/auth/authorization-service', () => ({ assertCan: vi.fn() }));
vi.mock('@/services/telemetry/telemetry-ingestion-service', () => ({
  ingestTelemetry: vi.fn(),
  ingestTelemetryBatch: vi.fn(),
  telemetryBuffer: { getStats: () => ({}), getDetailedStats: () => ({}) },
  getSamplingConfig: vi.fn(),
  getIngestStats: vi.fn(),
  findForeignEquipmentIds: vi.fn(async () => []),
}));
vi.mock('@/core/infrastructure/circuit-breakers', () => ({
  databaseCircuitBreaker: { getStats: () => ({ state: 'CLOSED' }) },
  CircuitOpenError: class CircuitOpenError extends Error {},
}));
vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/request-context', () => ({
  getRequestId: () => 'req-1',
  createJsonResponse: (body: unknown, init?: ResponseInit) =>
    Response.json(body as object, init),
}));
vi.mock('@/core/security/tenant-context', () => ({ setRequestTenantId: vi.fn() }));
vi.mock('@/services/telemetry/device-key-service', () => ({
  authenticateDeviceByKey: vi.fn(async () => null),
}));
vi.mock('@/lib/db', () => ({ db: {} }));

import { POST as telemetryPost } from '../route';
import { POST as batchPost } from '../batch/route';
import { POST as ingestPost, PATCH as ingestPatch } from '../ingest/route';

function req(url: string, method: string): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('F-RL-TELEMETRY-KEY — ключ лимита телеметрии не общий с голым IP', () => {
  it('POST /api/telemetry — ключ telemetry:<ip>, порог 1000/60 с', async () => {
    const res = await telemetryPost(req('http://localhost/api/telemetry', 'POST'));

    expect(rateLimiterCheckMock).toHaveBeenCalledWith('telemetry:203.0.113.7', {
      maxAttempts: 1000,
      windowMs: 60_000,
      blockDurationMs: 60_000,
    });
    expect(res.status).toBe(429);
  });

  it('POST /api/telemetry/batch — тот же ключ telemetry:<ip> (общий порог по замыслу)', async () => {
    const res = await batchPost(req('http://localhost/api/telemetry/batch', 'POST'));

    expect(rateLimiterCheckMock).toHaveBeenCalledWith('telemetry:203.0.113.7', {
      maxAttempts: 1000,
      windowMs: 60_000,
      blockDurationMs: 60_000,
    });
    expect(res.status).toBe(429);
  });

  it('POST /api/telemetry/ingest — свой ключ telemetry:ingest:<ip> (порог 500/60 с)', async () => {
    const res = await ingestPost(req('http://localhost/api/telemetry/ingest', 'POST'));

    expect(rateLimiterCheckMock).toHaveBeenCalledWith('telemetry:ingest:203.0.113.7', {
      maxAttempts: 500,
      windowMs: 60_000,
      blockDurationMs: 300_000,
    });
    expect(res.status).toBe(429);
  });

  it('PATCH /api/telemetry/ingest — тот же ключ, что у POST этого маршрута', async () => {
    const res = await ingestPatch(req('http://localhost/api/telemetry/ingest', 'PATCH'));

    expect(rateLimiterCheckMock).toHaveBeenCalledWith(
      'telemetry:ingest:203.0.113.7',
      expect.any(Object)
    );
    expect(res.status).toBe(429);
  });

  it('ключ телеметрии не совпадает с голым IP и ключом ingest-маршрута', async () => {
    await telemetryPost(req('http://localhost/api/telemetry', 'POST'));
    await ingestPost(req('http://localhost/api/telemetry/ingest', 'POST'));

    const keys = rateLimiterCheckMock.mock.calls.map((call) => call[0]);
    expect(keys).toEqual(['telemetry:203.0.113.7', 'telemetry:ingest:203.0.113.7']);
    // Голый IP в лимитер не уходит — иначе корзина снова общая с формой ORION.
    expect(keys).not.toContain('203.0.113.7');
  });
});
