import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findUniqueEquipmentMock, findFirstMock, createReadingMock, updateEquipmentMock, txMock } = vi.hoisted(() => ({
  findUniqueEquipmentMock: vi.fn(),
  findFirstMock: vi.fn(),
  createReadingMock: vi.fn(),
  updateEquipmentMock: vi.fn(),
  txMock: vi.fn(),
}));

vi.mock('@/lib/db', () => {
  const tx = {
    meterReading: { findFirst: findFirstMock, create: createReadingMock },
    equipment: { update: updateEquipmentMock },
  };
  return {
    db: {
      equipment: { findUnique: findUniqueEquipmentMock },
      // $transaction(cb) runs the callback with the tx stub above
      $transaction: (cb: (t: typeof tx) => unknown) => {
        txMock();
        return cb(tx);
      },
    },
  };
});

import { addMeterReading } from '../meter-reading';

describe('addMeterReading', () => {
  beforeEach(() => {
    findUniqueEquipmentMock.mockReset();
    findFirstMock.mockReset();
    createReadingMock.mockReset();
    updateEquipmentMock.mockReset();
    findUniqueEquipmentMock.mockResolvedValue({ id: 'eq_1' });
    createReadingMock.mockResolvedValue({ id: 'mr_1', engineHours: 5670, recordedAt: new Date() });
  });

  it('checks equipment existence scoped by tenantId (fail-closed IDOR guard)', async () => {
    findFirstMock.mockResolvedValue(null);
    await addMeterReading('eq_1', { engineHours: 100 }, { tenantId: 'orion' });
    expect(findUniqueEquipmentMock.mock.calls[0][0].where).toEqual({ id: 'eq_1', tenantId: 'orion' });
  });

  it('rejects a non-integer or negative reading', async () => {
    await expect(addMeterReading('eq_1', { engineHours: -5 }, { tenantId: 'orion' })).rejects.toThrow();
    await expect(addMeterReading('eq_1', { engineHours: 1.5 }, { tenantId: 'orion' })).rejects.toThrow();
  });

  it('syncs Equipment.engineHoursTotal to the latest reading', async () => {
    // first findFirst = previous latest (none); second = latest after insert
    findFirstMock.mockResolvedValueOnce(null).mockResolvedValueOnce({ engineHours: 5670 });
    await addMeterReading('eq_1', { engineHours: 5670 }, { tenantId: 'orion' });
    expect(updateEquipmentMock).toHaveBeenCalledWith({
      where: { id: 'eq_1' },
      data: { engineHoursTotal: 5670 },
    });
  });

  it('warns (but still saves) when the new reading is below the previous latest', async () => {
    findFirstMock.mockResolvedValueOnce({ engineHours: 6000 }).mockResolvedValueOnce({ engineHours: 6000 });
    const result = await addMeterReading('eq_1', { engineHours: 5800 }, { tenantId: 'orion' });
    expect(result.warning).toMatch(/меньше предыдущего/);
    expect(createReadingMock).toHaveBeenCalled();
  });

  it('does not warn when the reading is monotonic (>= previous)', async () => {
    findFirstMock.mockResolvedValueOnce({ engineHours: 5000 }).mockResolvedValueOnce({ engineHours: 5670 });
    const result = await addMeterReading('eq_1', { engineHours: 5670 }, { tenantId: 'orion' });
    expect(result.warning).toBeNull();
  });
});
