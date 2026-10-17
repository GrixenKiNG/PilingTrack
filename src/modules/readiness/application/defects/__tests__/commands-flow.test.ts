import {beforeEach, describe, expect, it, vi} from 'vitest';
import {resolveDefectCommand, triageDefectCommand, type DefectCommandContext} from '../commands';
import type {ReadinessTransaction} from '../../../infrastructure/tenant-transaction';

/**
 * Разбор и закрытие дефекта: что команда пишет в журнал и какие проверки делает
 * до записи. Репозиторий подменён целиком — SQL проверяют интеграционные наборы.
 */
const mocks = vi.hoisted(() => ({
  audit: vi.fn(), claim: vi.fn(), complete: vi.fn(), find: vi.fn(),
  defect: {get: vi.fn(), requireMaintenanceRecord: vi.fn(), triage: vi.fn(), close: vi.fn()},
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

const KEY = 'defect-flow-key-1234567890';
const NOW = new Date('2099-03-01T08:00:00Z');
const dispatcher: DefectCommandContext = {
  tenantId: 'tenant-1', actorId: 'dispatcher-1', actorName: 'Диспетчер', actorRole: 'DISPATCHER',
  actingAs: null, requestId: 'req', correlationId: 'corr',
};

const defectRow = (over: Record<string, unknown> = {}) => ({
  id: 'defect-1', tenantId: 'tenant-1', equipmentId: 'equipment-1', severity: 'CRITICAL', status: 'OPEN',
  title: 'Течь', description: '', node: null, reportedById: 'operator-1', reportedAt: NOW,
  inspectionId: null, shiftId: null, triagedById: null, triagedAt: null, maintenanceRecordId: null,
  resolvedById: null, resolvedAt: null, resolution: null, version: 1, createdAt: NOW, updatedAt: NOW, ...over,
});

let tx: {outboxEvent: {create: ReturnType<typeof vi.fn>}};
const asTx = () => tx as unknown as ReadinessTransaction;

beforeEach(() => {
  vi.clearAllMocks();
  Object.values(mocks.defect).forEach((fn) => fn.mockReset());
  mocks.claim.mockResolvedValue(true);
  tx = {outboxEvent: {create: vi.fn()}};
});

describe('triageDefectCommand', () => {
  it('сохраняет комментарий разбора в журнале аудита', async () => {
    mocks.defect.get.mockResolvedValue(defectRow());
    mocks.defect.triage.mockResolvedValue(defectRow({status: 'IN_WORK', version: 2}));

    await triageDefectCommand({
      tx: asTx(), context: dispatcher, id: 'defect-1', key: KEY, ifMatch: null,
      payload: {expectedVersion: 1, comment: 'передал механику Петрову, ждём запчасть'},
    });

    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'defect.triage', entityId: 'defect-1',
      metadata: {comment: 'передал механику Петрову, ждём запчасть'},
    }));
  });

  it('без комментария не добавляет метаданные', async () => {
    mocks.defect.get.mockResolvedValue(defectRow());
    mocks.defect.triage.mockResolvedValue(defectRow({status: 'IN_WORK', version: 2}));

    await triageDefectCommand({
      tx: asTx(), context: dispatcher, id: 'defect-1', key: KEY, ifMatch: null,
      payload: {expectedVersion: 1},
    });

    expect(mocks.audit.mock.calls[0][1].metadata).toBeUndefined();
  });

  it('связывает дефект с нарядом той же установки', async () => {
    mocks.defect.get.mockResolvedValue(defectRow());
    mocks.defect.triage.mockResolvedValue(defectRow({status: 'IN_WORK', version: 2, maintenanceRecordId: 'rec-1'}));

    await triageDefectCommand({
      tx: asTx(), context: dispatcher, id: 'defect-1', key: KEY, ifMatch: null,
      payload: {expectedVersion: 1, maintenanceRecordId: 'rec-1'},
    });

    expect(mocks.defect.requireMaintenanceRecord).toHaveBeenCalledWith({
      tenantId: 'tenant-1', id: 'rec-1', equipmentId: 'equipment-1',
    });
    expect(mocks.defect.triage).toHaveBeenCalledWith(expect.objectContaining({maintenanceRecordId: 'rec-1'}));
  });
});

describe('resolveDefectCommand', () => {
  it('закрывает дефект только после разбора: неразобранный отклоняется', async () => {
    mocks.defect.get.mockResolvedValue(defectRow({status: 'OPEN'}));

    await expect(resolveDefectCommand({
      tx: asTx(), context: dispatcher, id: 'defect-1', key: KEY, ifMatch: null,
      payload: {expectedVersion: 1, resolution: 'Заменили уплотнение'},
    })).rejects.toMatchObject({status: 409});
    expect(mocks.defect.close).not.toHaveBeenCalled();
  });
});
