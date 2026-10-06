import {beforeEach, describe, expect, it, vi} from 'vitest';
import {NextRequest} from 'next/server';

const mocks = vi.hoisted(() => ({
  queryShifts: vi.fn(),
  withReadinessRequestTransaction: vi.fn(),
  resolveReadinessRequestContext: vi.fn(),
}));

// Маршруты оборачивают обработчик в withApi/withMutation. Проверяем сам
// обработчик: обёртки возвращаем как есть, чтобы не поднимать весь стек
// (Sentry, rate limiter, метрики, кеш).
vi.mock('@/core/api-wrapper', () => ({
  withApi: (handler: unknown) => handler,
  withMutation: (handler: unknown) => handler,
  readJsonBody: (request: {json: () => unknown}) => request.json(),
}));

vi.mock('@/app/api/readiness/_shared/request-context', () => ({
  resolveReadinessRequestContext: mocks.resolveReadinessRequestContext,
}));

vi.mock('@/modules/readiness/infrastructure/tenant-transaction', () => ({
  withReadinessRequestTransaction: mocks.withReadinessRequestTransaction,
  withReadinessSerializableTransaction: vi.fn(),
}));

vi.mock('@/modules/readiness/application/shifts/queries', () => ({
  queryShifts: mocks.queryShifts,
}));

// Импорты — после vi.mock: vitest подменяет модули до того, как они разрешатся.
import {GET} from '../route';

const context = {
  tenantId: 'tenant-session',
  actorId: 'actor-session',
  requestId: 'req-1',
  correlationId: 'corr-1',
  capabilities: new Set<string>(['readiness.read']),
};

const request = (url: string) => new NextRequest(url, {headers: {}});

describe('GET /api/readiness/shifts state validation (F-07)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveReadinessRequestContext.mockResolvedValue({context});
    mocks.withReadinessRequestTransaction.mockImplementation((_tenantId: unknown, run: unknown) =>
      (run as (arg: object) => unknown)({
        tenantSettings: {findUnique: async () => ({timezone: 'Europe/Moscow'})},
      }));
    mocks.queryShifts.mockResolvedValue({items: []});
  });

  it('принимает PENDING_ACCEPTANCE как допустимое состояние смены', async () => {
    const response = await GET(request('http://localhost/api/readiness/shifts?state=PENDING_ACCEPTANCE'));
    expect(response.status).toBe(200);
    expect(mocks.queryShifts).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({state: 'PENDING_ACCEPTANCE'}),
    );
  });

  it('по-прежнему отклоняет неизвестное состояние смены кодом 400', async () => {
    const response = await GET(request('http://localhost/api/readiness/shifts?state=FOO'));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('Неизвестное состояние смены');
    expect(mocks.queryShifts).not.toHaveBeenCalled();
  });
});
