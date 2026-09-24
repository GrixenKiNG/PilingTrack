import {beforeEach, describe, expect, it, vi} from 'vitest';
import {NextRequest} from 'next/server';

const mocks = vi.hoisted(() => ({
  requestShiftAcceptanceCommand: vi.fn(),
  withReadinessSerializableTransaction: vi.fn(),
  resolveReadinessRequestContext: vi.fn(),
}));

// Маршруты оборачивают обработчик в withMutation/withApi. Проверяем сам
// обработчик: обёртку возвращаем как есть, чтобы не поднимать весь стек
// (Sentry, rate limiter, метрики, кеш). readJsonBody оставляем настоящим —
// битое тело должно превращаться в ServiceError.
vi.mock('@/core/api-wrapper', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/api-wrapper')>();
  return {
    ...actual,
    withApi: (handler: unknown) => handler,
    withMutation: (handler: unknown) => handler,
  };
});

vi.mock('@/app/api/readiness/_shared/request-context', () => ({
  resolveReadinessRequestContext: mocks.resolveReadinessRequestContext,
}));

vi.mock('@/modules/readiness/infrastructure/tenant-transaction', () => ({
  withReadinessSerializableTransaction: mocks.withReadinessSerializableTransaction,
}));

vi.mock('@/modules/readiness/application/shifts/commands', () => ({
  requestShiftAcceptanceCommand: mocks.requestShiftAcceptanceCommand,
}));

// Импорты — после vi.mock: vitest подменяет модули до того, как они разрешатся.
import {POST} from '../route';

const context = {
  tenantId: 'tenant-session',
  actorId: 'actor-session',
  actorName: 'Actor',
  actorRole: 'OPERATOR',
  actingAs: null,
  requestId: 'req-1',
  correlationId: 'corr-1',
};

const routeParams = () => ({params: Promise.resolve({id: 'some-id'})});

const postWithBody = (body: string) =>
  new NextRequest('http://localhost/api/readiness/shifts/some-id/request-acceptance', {
    method: 'POST',
    body,
    headers: {'content-type': 'application/json'},
  });

describe('POST /api/readiness/shifts/:id/request-acceptance body validation (F-09)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveReadinessRequestContext.mockResolvedValue({context});
    mocks.withReadinessSerializableTransaction.mockImplementation((_tenantId: unknown, tx: unknown) =>
      (tx as (arg: object) => unknown)({}));
    mocks.requestShiftAcceptanceCommand.mockResolvedValue({
      status: 200, body: {data: {id: 'some-id'}}, headers: {},
    });
  });

  it('отклоняет тело с неверным expectedVersion кодом 422 и не вызывает команду', async () => {
    const response = await POST(
      postWithBody(JSON.stringify({expectedVersion: 'not-a-number'})),
      routeParams(),
    );
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(mocks.requestShiftAcceptanceCommand).not.toHaveBeenCalled();
  });

  it('не глотает битое JSON-тело: бросает ошибку разбора, а не пустой объект', async () => {
    await expect(POST(postWithBody('{broken'), routeParams())).rejects.toThrow(
      'Тело запроса должно быть корректным JSON',
    );
    expect(mocks.requestShiftAcceptanceCommand).not.toHaveBeenCalled();
  });
});