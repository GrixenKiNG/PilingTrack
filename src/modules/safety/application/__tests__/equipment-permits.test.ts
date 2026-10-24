// @vitest-environment node
import {beforeEach, describe, expect, it, vi} from 'vitest';

/*
  Матрица допусков к технике: выдача и удаление пишут след в той же транзакции,
  а чужая организация не меняет и не удаляет чужие строки.
*/
const mocks = vi.hoisted(() => ({
  userFind: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn(), audit: vi.fn(),
}));
vi.mock('@/modules/audit', () => ({recordAuditEventInTx: mocks.audit}));
vi.mock('@/lib/db', () => {
  const db = {
    user: {findFirst: mocks.userFind},
    userEquipmentPermit: {upsert: mocks.upsert, deleteMany: mocks.deleteMany},
    $transaction: (run: (tx: unknown) => unknown) => run(db),
  };
  return {db};
});

import {deleteEquipmentPermit, upsertEquipmentPermit} from '../equipment-permits';

const payload = {
  equipmentKind: 'PILE_DRIVER', equipmentModel: 'SANY', scope: 'OPERATE', status: 'ALLOWED',
  validUntil: new Date('2027-01-01T00:00:00Z'),
} as never;
const grant = (over: Record<string, unknown> = {}) => upsertEquipmentPermit({
  tenantId: 'tenant-a', userId: 'worker-1', actor: {id: 'safety-1', name: 'Инженер ОТ'}, mayManage: true, payload, ...over,
} as Parameters<typeof upsertEquipmentPermit>[0]);
const remove = (over: Record<string, unknown> = {}) => deleteEquipmentPermit({
  tenantId: 'tenant-a', actorId: 'safety-1', permitId: 'permit-1', mayManage: true, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.audit.mockReset();
  mocks.audit.mockResolvedValue(undefined);
  mocks.userFind.mockResolvedValue({id: 'worker-1'});
  mocks.upsert.mockResolvedValue({id: 'permit-1'});
  mocks.deleteMany.mockResolvedValue({count: 1});
});

describe('выдача допуска к технике', () => {
  it('пишет след в той же транзакции со сроком в ISO', async () => {
    await grant();
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'user.equipment_permit.saved', scope: 'users', actorId: 'safety-1',
      targetId: 'worker-1', tenantId: 'tenant-a',
      metadata: expect.objectContaining({permitId: 'permit-1', validUntil: '2027-01-01T00:00:00.000Z'}),
    }));
  });

  it('сбой следа не глушится', async () => {
    const failure = new Error('след не записан');
    mocks.audit.mockRejectedValue(failure);
    await expect(grant()).rejects.toBe(failure);
  });

  it('работник чужой организации: 404, ни допуска, ни следа', async () => {
    mocks.userFind.mockResolvedValue(null);
    await expect(grant({tenantId: 'tenant-b'})).rejects.toMatchObject({status: 404});
    expect(mocks.userFind).toHaveBeenCalledWith(expect.objectContaining({where: {id: 'worker-1', tenantId: 'tenant-b'}}));
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('без права выдавать — 403 без записи', async () => {
    await expect(grant({mayManage: false})).rejects.toMatchObject({status: 403});
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});

describe('удаление допуска к технике', () => {
  it('удаляет только в своей организации и пишет след', async () => {
    await remove();
    expect(mocks.deleteMany).toHaveBeenCalledWith({where: {id: 'permit-1', tenantId: 'tenant-a'}});
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'user.equipment_permit.deleted', actorId: 'safety-1', targetId: 'permit-1', tenantId: 'tenant-a',
    }));
  });

  it('чужая строка или её нет: 404 и следа нет', async () => {
    mocks.deleteMany.mockResolvedValue({count: 0});
    await expect(remove({tenantId: 'tenant-b'})).rejects.toMatchObject({status: 404});
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('сбой следа не глушится', async () => {
    const failure = new Error('след не записан');
    mocks.audit.mockRejectedValue(failure);
    await expect(remove()).rejects.toBe(failure);
  });
});
