import {beforeEach, describe, expect, it, vi} from 'vitest';
import {createDefectCommand, type DefectCommandContext} from '../commands';
import {hashCommandRequest} from '../../command-pipeline/idempotency';
import type {ReadinessTransaction} from '../../../infrastructure/tenant-transaction';

/**
 * Дефект высокого и критического уровня сам заводит заявку на ТО (решение
 * владельца 18.10.2026). Репозиторий дефектов подменён; наряд пишет транзакция,
 * её клиент и проверяем. SQL проверяют интеграционные наборы.
 */
const mocks = vi.hoisted(() => ({
  audit: vi.fn(), claim: vi.fn(), complete: vi.fn(), find: vi.fn(), enqueue: vi.fn(),
  defect: {requireActor: vi.fn(), requireEquipment: vi.fn(), create: vi.fn()},
}));

vi.mock('../../../infrastructure/audit/record-audit', () => ({recordChainedReadinessAudit: mocks.audit}));
vi.mock('../../../infrastructure/command-pipeline/idempotency-repository', () => ({
  PrismaCommandIdempotencyRepository: class {
    tryClaim = mocks.claim; complete = mocks.complete; find = mocks.find;
  },
}));
vi.mock('../../../infrastructure/defects/defect-repository', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../infrastructure/defects/defect-repository')>()),
  DefectRepository: class { constructor() { return mocks.defect as never; } },
}));
vi.mock('@/core/notifications/durable-alert', () => ({enqueueCriticalDefects: mocks.enqueue}));

const KEY = 'defect-repair-key-1234567890';
const NOW = new Date('2099-03-01T08:00:00Z');
const operator: DefectCommandContext = {
  tenantId: 'tenant-1', actorId: 'operator-1', actorName: 'Оператор', actorRole: 'OPERATOR',
  actingAs: null, requestId: 'req', correlationId: 'corr',
};

let tx: {
  outboxEvent: {create: ReturnType<typeof vi.fn>};
  maintenanceRecord: {create: ReturnType<typeof vi.fn>};
};
const asTx = () => tx as unknown as ReadinessTransaction;

const defectRow = (over: Record<string, unknown> = {}) => ({
  id: 'defect-1', tenantId: 'tenant-1', equipmentId: 'equipment-1', severity: 'NORMAL', status: 'OPEN',
  title: 'Течь гидролинии', description: '', node: null, reportedById: 'operator-1', reportedAt: NOW,
  inspectionId: null, shiftId: null, triagedById: null, triagedAt: null, maintenanceRecordId: null,
  resolvedById: null, resolvedAt: null, resolution: null, version: 1, createdAt: NOW, updatedAt: NOW, ...over,
});

const report = (severity: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL', key = KEY) => createDefectCommand({
  tx: asTx(), context: operator, key,
  payload: {equipmentId: 'equipment-1', severity, title: 'Течь гидролинии'},
});

beforeEach(() => {
  vi.clearAllMocks();
  Object.values(mocks.defect).forEach((fn) => fn.mockReset());
  mocks.claim.mockResolvedValue(true);
  mocks.defect.create.mockImplementation(async (input: {severity: string; maintenanceRecordId: string | null}) =>
    defectRow({severity: input.severity, maintenanceRecordId: input.maintenanceRecordId}));
  tx = {
    outboxEvent: {create: vi.fn()},
    maintenanceRecord: {create: vi.fn(async () => ({id: 'mr-1'}))},
  };
});

describe('createDefectCommand: заявка ТО по уровню дефекта', () => {
  it.each(['HIGH', 'CRITICAL'] as const)('дефект уровня %s заводит заявку ТО и привязывает её', async (severity) => {
    const result = await report(severity);

    expect(tx.maintenanceRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 'tenant-1', equipmentId: 'equipment-1', type: 'REPAIR', status: 'PLANNED',
        priority: 'HIGH', createdById: 'operator-1', title: expect.stringContaining('Течь гидролинии'),
      }),
      select: {id: true},
    });
    expect(mocks.defect.create).toHaveBeenCalledWith(expect.objectContaining({maintenanceRecordId: 'mr-1'}));
    expect(result.body).toMatchObject({data: {maintenanceRecordId: 'mr-1'}});
  });

  it.each(['LOW', 'NORMAL'] as const)('дефект уровня %s заявку не заводит: остаётся ручным', async (severity) => {
    const result = await report(severity);

    expect(tx.maintenanceRecord.create).not.toHaveBeenCalled();
    expect(mocks.defect.create).toHaveBeenCalledWith(expect.objectContaining({maintenanceRecordId: null}));
    expect(result.body).toMatchObject({data: {maintenanceRecordId: null}});
  });

  it('повтор с тем же ключом не создаёт вторую заявку', async () => {
    // Хэш запроса считаем той же функцией, что и команда: иначе повтор отвергнут как чужой ключ.
    const payload = {equipmentId: 'equipment-1', severity: 'HIGH', title: 'Течь гидролинии'};
    const requestHash = hashCommandRequest({method: 'POST', routeTemplate: '/api/readiness/defects',
      pathIds: {}, body: payload, actorId: 'operator-1'});
    mocks.claim.mockResolvedValue(false);
    mocks.find.mockResolvedValue({
      status: 'completed', requestHash, statusCode: 201, responseHeaders: {},
      result: {data: defectRow({severity: 'HIGH', maintenanceRecordId: 'mr-1'})},
    });

    const result = await report('HIGH');

    expect(tx.maintenanceRecord.create).not.toHaveBeenCalled();
    expect(mocks.defect.create).not.toHaveBeenCalled();
    expect(result.replayed).toBe(true);
  });

  it('в журнале фиксирования дефекта записаны автор и заявка ТО', async () => {
    await report('HIGH');

    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'defect.reported',
      actor: expect.objectContaining({id: 'operator-1'}),
      metadata: {repairOrderId: 'mr-1'},
    }));
  });

  it('обычный дефект в журнале без метаданных о заявке', async () => {
    await report('NORMAL');

    expect(mocks.audit.mock.calls[0][1].metadata).toBeUndefined();
  });
});
