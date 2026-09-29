/**
 * deleteEquipment — защита от разрушающего удаления установки (F-R39-2).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findUniqueMock, deleteMock, queryRawMock, transactionMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  deleteMock: vi.fn(),
  queryRawMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    $transaction: transactionMock,
    equipment: { findUnique: findUniqueMock, delete: deleteMock },
  },
}));

import { deleteEquipment } from '../equipment-command.service';

const ALL_ZERO = {
  crews: 0,
  reports: 0,
  shifts: 0,
  workPermits: 0,
  inspections: 0,
  meterReadings: 0,
  maintenanceRecords: 0,
  maintenancePlans: 0,
  fuelLogs: 0,
  defects: 0,
  documents: 0,
  deviceKeys: 0,
  telematicsDevices: 0,
  telematicsAssignments: 0,
  operatorChecklistExecutions: 0,
  operatorShiftEvidence: 0,
};

function found(counts: Partial<typeof ALL_ZERO> = {}) {
  findUniqueMock.mockResolvedValue({ id: 'eq_1', _count: { ...ALL_ZERO, ...counts } });
}

describe('deleteEquipment', () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    deleteMock.mockReset();
    deleteMock.mockResolvedValue({ id: 'eq_1' });
    queryRawMock.mockReset().mockResolvedValue([{ id: 'eq_1' }]);
    transactionMock.mockReset().mockImplementation(
      (fn: (client: unknown) => unknown) =>
        fn({ $queryRaw: queryRawMock, equipment: { findUnique: findUniqueMock, delete: deleteMock } }),
    );
  });

  it('deletes a rig with no history at all', async () => {
    found();
    const result = await deleteEquipment('eq_1', 'orion');

    expect(findUniqueMock.mock.calls[0][0].where).toEqual({ id: 'eq_1', tenantId: 'orion' });
    expect(deleteMock).toHaveBeenCalledWith({ where: { id: 'eq_1' } });
    expect(result).toEqual({ success: true });
  });

  it('throws 404 when the rig is missing', async () => {
    findUniqueMock.mockResolvedValue(null);
    await expect(deleteEquipment('missing', 'orion')).rejects.toThrow('Установка не найдена');
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('refuses to delete a rig with a disbanded (inactive) crew', async () => {
    found({ crews: 1 });
    await expect(deleteEquipment('eq_1', 'orion')).rejects.toMatchObject({ status: 409 });
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('refuses to delete a rig whose only history is reports (equipmentId would be nulled)', async () => {
    found({ reports: 2 });
    await expect(deleteEquipment('eq_1', 'orion')).rejects.toThrow(
      'Нельзя удалить установку: у неё есть история (отчёты). Выведите её из эксплуатации — история сохранится.',
    );
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it('lists every history kind that is present', async () => {
    found({ inspections: 4, meterReadings: 9, fuelLogs: 1, defects: 1 });
    await expect(deleteEquipment('eq_1', 'orion')).rejects.toThrow(
      'Нельзя удалить установку: у неё есть история (осмотры, показания моточасов, записи топлива, дефекты). Выведите её из эксплуатации — история сохранится.',
    );
  });

  it('locks the rig row FOR UPDATE before counting, all inside one transaction', async () => {
    found();
    await deleteEquipment('eq_1', 'orion');

    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(queryRawMock.mock.calls[0][0].join('')).toContain('SELECT id FROM "Equipment" WHERE id = ');
    expect(queryRawMock.mock.calls[0][0].join('')).toContain('FOR UPDATE');
    expect(queryRawMock.mock.calls[0][1]).toBe('eq_1');
    expect(queryRawMock.mock.invocationCallOrder[0]).toBeLessThan(findUniqueMock.mock.invocationCallOrder[0]);
    expect(queryRawMock.mock.invocationCallOrder[0]).toBeLessThan(deleteMock.mock.invocationCallOrder[0]);
  });

  it('maps a RESTRICT foreign-key failure (P2003) to 409 instead of 500', async () => {
    found();
    deleteMock.mockRejectedValue(Object.assign(new Error('Foreign key constraint violated'), { code: 'P2003' }));

    await expect(deleteEquipment('eq_1', 'orion')).rejects.toMatchObject({ status: 409 });
  });

  it('rethrows unexpected delete errors untouched', async () => {
    found();
    deleteMock.mockRejectedValue(new Error('boom'));
    await expect(deleteEquipment('eq_1', 'orion')).rejects.toThrow('boom');
  });
});
