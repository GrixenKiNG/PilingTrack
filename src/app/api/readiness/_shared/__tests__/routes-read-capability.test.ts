import {beforeEach, describe, expect, it, vi} from 'vitest';
import {NextRequest, NextResponse} from 'next/server';

const mocks = vi.hoisted(() => ({
  resolveReadinessRequestContext: vi.fn(),
  withReadinessRequestTransaction: vi.fn(),
}));

// Маршруты оборачивают обработчик в withApi. Проверяем сам обработчик: обёртка
// возвращает его как есть, чтобы не поднимать весь стек (Sentry, rate limiter,
// метрики, кеш). Всё, что нужно, — дойти до проверки прав.
vi.mock('@/core/api-wrapper', () => ({
  withApi: (handler: unknown) => handler,
  // route-adapter вызывает withMutation в момент сборки обёртки команды,
  // поэтому мутация должна существовать, хотя в этих тестах не вызывается.
  withMutation: (handler: unknown) => handler,
  readJsonBody: (request: {json: () => unknown}) => request.json(),
}));

// На пути 403 резолвер контекста подменяется: база и матрица доступов не
// нужны — проверка `readiness.read` срабатывает до транзакции.
vi.mock('../../_shared/request-context', () => ({
  resolveReadinessRequestContext: mocks.resolveReadinessRequestContext,
}));

// Считывающие команды не должны трогать БД на запрещённом пути.
vi.mock('@/modules/readiness/infrastructure/tenant-transaction', () => ({
  withReadinessRequestTransaction: mocks.withReadinessRequestTransaction,
  withReadinessSerializableTransaction: vi.fn(),
}));

// Импорты — после vi.mock: vitest подменяет модули до того, как они
// разрешатся при импорте маршрутов.
import {GET as shiftsListGet} from '../../shifts/route';
import {GET as shiftByIdGet} from '../../shifts/[id]/route';
import {GET as handoverByIdGet} from '../../handovers/[id]/route';
import {GET as permitByIdGet} from '../../work-permits/[id]/route';
import {GET as currentGet} from '../../current/route';

const FORBIDDEN_MESSAGE = 'Нет доступа к контуру технической готовности';

// Контекст без `readiness.read`: пустой набор прав.
const withoutReadCapability = {
  tenantId: 'tenant-session',
  actorId: 'actor-session',
  requestId: 'req-1',
  correlationId: 'corr-1',
  capabilities: new Set<string>(),
};

const request = (url: string) => new NextRequest(url, {headers: {}});

const routeParams = {params: Promise.resolve({id: 'some-id'})};

// Общая проверка ответа: 403 с той же ошибкой, что у соседнего списка нарядов.
const expectForbidden = async (produce: () => Promise<NextResponse>) => {
  const response = await produce();
  expect(response.status).toBe(403);
  const body = await response.json();
  expect(body.error.code).toBe('VALIDATION_ERROR');
  expect(body.error.message).toBe(FORBIDDEN_MESSAGE);
};

describe('readiness read endpoints require the readiness.read capability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveReadinessRequestContext.mockResolvedValue({context: withoutReadCapability});
  });

  it('shifts list rejects a context without readiness.read with 403', () => expectForbidden(() =>
    shiftsListGet(request('http://localhost/api/readiness/shifts'))));

  it('shift by id rejects a context without readiness.read with 403', () => expectForbidden(() =>
    shiftByIdGet(request('http://localhost/api/readiness/shifts/some-id'), routeParams)));

  it('handover by id rejects a context without readiness.read with 403', () => expectForbidden(() =>
    handoverByIdGet(request('http://localhost/api/readiness/handovers/some-id'), routeParams)));

  it('work permit by id rejects a context without readiness.read with 403', () => expectForbidden(() =>
    permitByIdGet(request('http://localhost/api/readiness/work-permits/some-id'), routeParams)));

  it('current readiness rejects a context without readiness.read with 403', () => expectForbidden(() =>
    currentGet(request('http://localhost/api/readiness/current'))));

  it('never starts a read transaction for a forbidden request', async () => {
    await shiftsListGet(request('http://localhost/api/readiness/shifts'));
    const {withReadinessRequestTransaction} = await import(
      '@/modules/readiness/infrastructure/tenant-transaction'
    );
    expect(withReadinessRequestTransaction).not.toHaveBeenCalled();
  });
});

describe('current readiness equipment activity', () => {
  it('returns source activity without altering stored verdicts or historical snapshots', async () => {
    const calculatedAt = new Date('2026-08-10T12:00:00.000Z');
    const current = ['inactive', 'active', 'missing-equipment'].map((equipmentId) => ({
      equipmentId, snapshotId: `snapshot-${equipmentId}`, status: 'READY', verdict: 'ALLOW',
      score: 96, calculatedAt,
    }));
    const snapshots = current.map((item) => ({
      id: item.snapshotId, status: 'READY', score: 96, calculatedAt,
      blockers: [], warnings: [], evidence: {equipmentId: item.equipmentId},
      facts: {accepted: true}, triggerType: 'INSPECTION_COMPLETED', ruleSetVersion: 'v1',
    }));
    const savedSnapshots = structuredClone(snapshots);
    const tx = {
      currentReadiness: {findMany: vi.fn().mockResolvedValue(current)},
      readinessScoreSnapshot: {findMany: vi.fn().mockResolvedValue(snapshots)},
      equipment: {findMany: vi.fn().mockResolvedValue([
        {id: 'inactive', isActive: false}, {id: 'active', isActive: true},
      ])},
    };
    mocks.resolveReadinessRequestContext.mockResolvedValue({
      context: {...withoutReadCapability, capabilities: new Set(['readiness.read'])},
    });
    mocks.withReadinessRequestTransaction.mockImplementation(
      async (_tenantId: string, callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    );
    const response = await currentGet(request('http://localhost/api/readiness/current'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual([
      expect.objectContaining({equipmentId: 'inactive', equipmentActive: false, status: 'READY', score: 96}),
      expect.objectContaining({equipmentId: 'active', equipmentActive: true, status: 'READY', score: 96}),
      expect.objectContaining({equipmentId: 'missing-equipment', equipmentActive: false, status: 'READY', score: 96}),
    ]);
    expect(tx.equipment.findMany).toHaveBeenCalledWith({
      where: {tenantId: 'tenant-session', id: {in: ['inactive', 'active', 'missing-equipment']}},
      select: {id: true, isActive: true},
    });
    expect(snapshots).toEqual(savedSnapshots);
  });
});
