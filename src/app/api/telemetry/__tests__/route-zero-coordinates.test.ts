/**
 * Одиночная запись с координатами 0/0 сохраняет их, а не превращает в NULL
 * (разбор Codex N21X3, п.3: `|| undefined` теряет ноль).
 */
import { expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ ingest: vi.fn() }));

vi.mock('@/lib/auth', () => ({
  requireAuth: async () => ({ user: { id: 'user-a', role: 'OPERATOR', tenantId: 'tenant-a' } }),
}));
vi.mock('@/lib/tenant', () => ({ requireTenantId: () => 'tenant-a' }));
vi.mock('@/lib/csrf-protection', () => ({ withCsrf: () => null }));
vi.mock('@/lib/rate-limiter', () => ({
  rateLimiter: { check: async () => ({ allowed: true }) },
  getRateLimitIdentifier: () => 'test',
}));
vi.mock('@/services/auth/authorization-service', () => ({ assertCan: vi.fn() }));
vi.mock('@/modules/telemetry', () => ({
  ingestTelemetry: mocks.ingest,
  ingestTelemetryBatch: vi.fn(),
  findForeignEquipmentIds: async () => [],
  telemetryBuffer: { getStats: () => ({}) },
  getSamplingConfig: vi.fn(),
  getIngestStats: vi.fn(),
}));
vi.mock('@/core/infrastructure/circuit-breakers', () => ({
  databaseCircuitBreaker: { getStats: () => ({ state: 'CLOSED' }) },
  CircuitOpenError: class extends Error {},
}));
vi.mock('@/core/api-wrapper', () => ({
  withApi: (handler: unknown) => handler,
  withMutation: (handler: unknown) => handler,
  readJsonBody: (request: Request) => request.json(),
}));

import { POST } from '../route';

it('сохраняет нулевые широту и долготу одиночной записи', async () => {
  mocks.ingest.mockResolvedValue('buffered-test');

  const response = await POST(new NextRequest('http://localhost/api/telemetry', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'equipment_gps', equipmentId: 'equipment-a', value: 0, latitude: 0, longitude: 0 }),
  }));

  expect(response.status).toBe(200);
  expect(mocks.ingest).toHaveBeenCalledWith(expect.objectContaining({ latitude: 0, longitude: 0 }));
});
