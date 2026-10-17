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

describe('resolveDefectCommand: проверка вторым лицом', () => {
  const mechanic: DefectCommandContext = {...dispatcher, actorId: 'mechanic-1', actorName: 'Механик', actorRole: 'MECHANIC'};
  const inWork = (over: Record<string, unknown> = {}) =>
    defectRow({status: 'IN_WORK', severity: 'CRITICAL', triagedById: 'dispatcher-1', ...over});

  const resolveAs = async (context: DefectCommandContext, row: ReturnType<typeof defectRow>) => {
    mocks.defect.get.mockResolvedValue(row);
    mocks.defect.close.mockResolvedValue({...row, status: 'CLOSED', version: row.version + 1});
    await resolveDefectCommand({
      tx: asTx(), context, id: 'defect-1', key: KEY, ifMatch: null,
      payload: {expectedVersion: row.version, resolution: 'Заменили уплотнение'},
    });
    return mocks.audit.mock.calls[0][1];
  };

  it('критический дефект закрыл тот, кто взял его в работу: пометка в аудите', async () => {
    const entry = await resolveAs(dispatcher, inWork());
    expect(entry).toMatchObject({action: 'defect.resolve', metadata: {withoutSecondPersonCheck: true}});
  });

  it('«Действую как» не делает человека другим лицом: сравниваются настоящие id', async () => {
    const entry = await resolveAs({...dispatcher, actingAs: 'MECHANIC'}, inWork());
    expect(entry.metadata).toEqual({withoutSecondPersonCheck: true});
  });

  it('критический дефект закрыл другой человек: пометки нет', async () => {
    const entry = await resolveAs(mechanic, inWork());
    expect(entry.metadata).toBeUndefined();
    expect(mocks.defect.close).toHaveBeenCalledTimes(1);
  });

  it('не критический дефект закрыл тот же человек: пометки нет', async () => {
    const entry = await resolveAs(dispatcher, inWork({severity: 'HIGH'}));
    expect(entry.metadata).toBeUndefined();
  });

  it('пометка ничего не блокирует: дефект закрывается', async () => {
    await resolveAs(dispatcher, inWork());
    expect(mocks.defect.close).toHaveBeenCalledWith(expect.objectContaining({status: 'CLOSED'}));
  });
});
