import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  findUniqueEquipmentMock, findFirstMock, createReadingMock, updateEquipmentMock,
  outboxCreateManyMock, deleteReadingMock, txMock,
} = vi.hoisted(() => ({
  findUniqueEquipmentMock: vi.fn(),
  findFirstMock: vi.fn(),
  createReadingMock: vi.fn(),
  updateEquipmentMock: vi.fn(),
  // Показание меняет наработку — вход критерия готовности «Моточасы», поэтому
  // команда заказывает пересчёт снимка в той же транзакции.
  outboxCreateManyMock: vi.fn(),
  deleteReadingMock: vi.fn(),
  txMock: vi.fn(),
}));

vi.mock('@/lib/db', () => {
  const tx = {
    meterReading: { findFirst: findFirstMock, create: createReadingMock, delete: deleteReadingMock },
    equipment: { update: updateEquipmentMock },
    outboxEvent: { createMany: outboxCreateManyMock },
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

import { addMeterReading, canDecreaseMeter, checkMeterReading } from '../meter-reading';

describe('addMeterReading', () => {
  beforeEach(() => {
    findUniqueEquipmentMock.mockReset();
    findFirstMock.mockReset();
    createReadingMock.mockReset();
    updateEquipmentMock.mockReset();
    outboxCreateManyMock.mockReset();
    deleteReadingMock.mockReset();
    findUniqueEquipmentMock.mockResolvedValue({ id: 'eq_1' });
    createReadingMock.mockResolvedValue({ id: 'mr_1', engineHours: 5670, recordedAt: new Date() });
    outboxCreateManyMock.mockResolvedValue({ count: 1 });
  });

  it('заказывает пересчёт готовности в той же транзакции', async () => {
    findFirstMock.mockResolvedValueOnce(null).mockResolvedValueOnce({ engineHours: 5670 });
    await addMeterReading('eq_1', { engineHours: 5670 }, { tenantId: 'orion' });
    const [{ data }] = outboxCreateManyMock.mock.calls[0];
    expect(data[0]).toMatchObject({
      type: 'ReadinessSnapshotRequested',
      tenantId: 'orion',
      payload: expect.objectContaining({ triggerType: 'METER_READING_RECORDED', equipmentId: 'eq_1' }),
    });
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

  it('отклоняет показание ниже предыдущего и ничего не пишет', async () => {
    findFirstMock.mockResolvedValueOnce({ engineHours: 6000 });
    await expect(
      addMeterReading('eq_1', { engineHours: 5800 }, { tenantId: 'orion' }),
    ).rejects.toThrow(/меньше предыдущего/);
    expect(createReadingMock).not.toHaveBeenCalled();
    expect(updateEquipmentMock).not.toHaveBeenCalled();
  });

  it('разрешает снижение с предупреждением, когда счётчик заменили', async () => {
    findFirstMock.mockResolvedValueOnce({ engineHours: 6000 }).mockResolvedValueOnce({ engineHours: 12 });
    const result = await addMeterReading(
      'eq_1', { engineHours: 12 }, { tenantId: 'orion', allowDecrease: true },
    );
    expect(result.warning).toMatch(/меньше предыдущего/);
    expect(createReadingMock).toHaveBeenCalled();
  });

  it('предупреждает о прибавке больше 20 м/ч, но показание принимает', async () => {
    findFirstMock.mockResolvedValueOnce({ engineHours: 5000 }).mockResolvedValueOnce({ engineHours: 5670 });
    const result = await addMeterReading('eq_1', { engineHours: 5670 }, { tenantId: 'orion' });
    expect(result.warning).toMatch(/Прибавка 670 м\/ч/);
    expect(createReadingMock).toHaveBeenCalled();
  });

  it('не предупреждает при обычной сменной прибавке', async () => {
    findFirstMock.mockResolvedValueOnce({ engineHours: 5000 }).mockResolvedValueOnce({ engineHours: 5008 });
    const result = await addMeterReading('eq_1', { engineHours: 5008 }, { tenantId: 'orion' });
    expect(result.warning).toBeNull();
  });
});

describe('checkMeterReading', () => {
  it('первое показание принимает без замечаний', () => {
    expect(checkMeterReading(100, null)).toEqual({ reject: null, warning: null });
  });

  it('равное предыдущему — не снижение', () => {
    expect(checkMeterReading(5000, 5000)).toEqual({ reject: null, warning: null });
  });

  it('ровно 20 м/ч прибавки — ещё не повод предупреждать', () => {
    expect(checkMeterReading(5020, 5000).warning).toBeNull();
  });

  it('21 м/ч прибавки — уже повод', () => {
    expect(checkMeterReading(5021, 5000).warning).toMatch(/Прибавка 21 м\/ч/);
  });

  it('снижение без права — отказ, с правом — предупреждение', () => {
    expect(checkMeterReading(4999, 5000).reject).toMatch(/Счётчик назад не идёт/);
    expect(checkMeterReading(4999, 5000).warning).toBeNull();

    const allowed = checkMeterReading(4999, 5000, { allowDecrease: true });
    expect(allowed.reject).toBeNull();
    expect(allowed.warning).toMatch(/меньше предыдущего/);
  });
});

describe('canDecreaseMeter', () => {
  it('снижать счётчик может администратор и механик', () => {
    expect(canDecreaseMeter('ADMIN')).toBe(true);
    expect(canDecreaseMeter('MECHANIC')).toBe(true);
  });

  it('оператору и остальным — нельзя', () => {
    for (const role of ['OPERATOR', 'ASSISTANT', 'DISPATCHER', 'FOREMAN', 'SAFETY_ENGINEER', null]) {
      expect(canDecreaseMeter(role)).toBe(false);
    }
  });
});
