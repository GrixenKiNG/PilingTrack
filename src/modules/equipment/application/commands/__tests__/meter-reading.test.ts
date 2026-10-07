import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  findUniqueEquipmentMock, findFirstMock, createReadingMock, executeRawMock,
  outboxCreateManyMock, deleteReadingMock, findUniqueReadingMock, txMock,
} = vi.hoisted(() => ({
  findUniqueEquipmentMock: vi.fn(),
  findFirstMock: vi.fn(),
  createReadingMock: vi.fn(),
  // Кэш наработки Equipment.engineHoursTotal = последнее показание; его считает
  // сама база под блокировкой строки установки, а не значение из JS.
  executeRawMock: vi.fn(),
  // Показание меняет наработку — вход критерия готовности «Моточасы», поэтому
  // команда заказывает пересчёт снимка в той же транзакции.
  outboxCreateManyMock: vi.fn(),
  deleteReadingMock: vi.fn(),
  findUniqueReadingMock: vi.fn(),
  txMock: vi.fn(),
}));

vi.mock('@/lib/db', () => {
  const tx = {
    meterReading: { findFirst: findFirstMock, create: createReadingMock, delete: deleteReadingMock },
    outboxEvent: { createMany: outboxCreateManyMock },
    $executeRaw: executeRawMock,
  };
  return {
    db: {
      equipment: { findUnique: findUniqueEquipmentMock },
      meterReading: { findUnique: findUniqueReadingMock },
      // $transaction(cb) runs the callback with the tx stub above
      $transaction: (cb: (t: typeof tx) => unknown) => {
        txMock();
        return cb(tx);
      },
    },
  };
});

import { addMeterReading, canDecreaseMeter, checkMeterReading, deleteMeterReading } from '../meter-reading';

/** SQL тегированного шаблона с `?` вместо параметров — для проверки формы запроса. */
const sqlOf = (call: unknown[]): string => (call[0] as TemplateStringsArray).join('?');

describe('addMeterReading', () => {
  beforeEach(() => {
    findUniqueEquipmentMock.mockReset();
    findFirstMock.mockReset();
    createReadingMock.mockReset();
    executeRawMock.mockReset();
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

  it('блокирует строку установки до записи показания, потом ставит кэш по последнему показанию', async () => {
    findFirstMock.mockResolvedValueOnce(null);
    await addMeterReading('eq_1', { engineHours: 5670 }, { tenantId: 'orion' });
    const [lock, sync] = executeRawMock.mock.calls;
    expect(sqlOf(lock)).toMatch(/FROM "Equipment"\s+WHERE id = \? AND "tenantId" = \?\s+FOR UPDATE/);
    expect(lock.slice(1)).toEqual(['eq_1', 'orion']);
    const sql = sqlOf(sync);
    expect(sql).toMatch(/UPDATE "Equipment"/);
    expect(sql).toMatch(/SET "engineHoursTotal" = \(\s+SELECT m\."engineHours" FROM "MeterReading" m/);
    expect(sql).toMatch(/ORDER BY m\."recordedAt" DESC, m\."createdAt" DESC/);
    expect(sql).toMatch(/WHERE id = \? AND "tenantId" = \?/);
    expect(sync.slice(1)).toEqual(['eq_1', 'orion', 'eq_1', 'orion']);
    // Блокировка раньше записи показания, пересчёт — после.
    expect(executeRawMock.mock.invocationCallOrder[0]).toBeLessThan(createReadingMock.mock.invocationCallOrder[0]);
    expect(createReadingMock.mock.invocationCallOrder[0]).toBeLessThan(executeRawMock.mock.invocationCallOrder[1]);
  });

  // Владелец 07.10.2026: «нельзя заменить моточасы, после смены они заново
  // появляются». Кэш держал максимум (GREATEST): замена счётчика и правка в
  // карточке не снижали наработку, а новое показание возвращало старую цифру.
  it('кэш наработки не держит максимум: правка вниз и показание после неё не возвращают старую цифру', async () => {
    findFirstMock.mockResolvedValueOnce({ engineHours: 99999 }).mockResolvedValueOnce({ engineHours: 3000 });
    await addMeterReading('eq_1', { engineHours: 3000 }, { tenantId: 'orion', allowDecrease: true });
    for (const call of executeRawMock.mock.calls) expect(sqlOf(call)).not.toMatch(/GREATEST|MAX\(/);
    expect(createReadingMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ engineHours: 3000 }),
    }));
  });

  it('отклоняет показание ниже предыдущего и ничего не пишет', async () => {
    findFirstMock.mockResolvedValueOnce({ engineHours: 6000 });
    await expect(
      addMeterReading('eq_1', { engineHours: 5800 }, { tenantId: 'orion' }),
    ).rejects.toThrow(/меньше предыдущего/);
    expect(createReadingMock).not.toHaveBeenCalled();
    // Только блокировка строки; кэш не пересчитывался.
    expect(executeRawMock).toHaveBeenCalledTimes(1);
    expect(sqlOf(executeRawMock.mock.calls[0])).toMatch(/FOR UPDATE/);
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

  it('повторная отправка отчёта с тем же значением не создаёт второе показание', async () => {
    // Первый findFirst — поиск уже записанного показания с той же пометкой.
    const existing = { id: 'mr_dup', engineHours: 5670, recordedAt: new Date() };
    findFirstMock.mockResolvedValueOnce(existing);
    const result = await addMeterReading(
      'eq_1',
      { engineHours: 5670, note: 'Показание из сменного отчёта за 2025-09-20' },
      { tenantId: 'orion', dedupeByNote: true },
    );
    expect(createReadingMock).not.toHaveBeenCalled();
    expect(result).toEqual({ reading: existing, warning: null });
  });

  it('исправленное значение за ту же дату пишется новым показанием', async () => {
    findFirstMock
      .mockResolvedValueOnce(null) // дубля с новым значением нет — это правка
      .mockResolvedValueOnce({ engineHours: 5000 }) // предыдущее показание
      .mockResolvedValueOnce({ engineHours: 5678 }); // последнее после вставки
    const result = await addMeterReading(
      'eq_1',
      { engineHours: 5678, note: 'Показание из сменного отчёта за 2025-09-20' },
      { tenantId: 'orion', dedupeByNote: true },
    );
    expect(createReadingMock).toHaveBeenCalledTimes(1);
    expect(createReadingMock.mock.calls[0][0].data.note).toBe('Показание из сменного отчёта за 2025-09-20');
    expect(result.reading.id).toBe('mr_1');
  });

  it('без флага дедупликации та же цифра пишется повторно (осмотр, карточка)', async () => {
    findFirstMock.mockResolvedValueOnce({ engineHours: 5670 }).mockResolvedValueOnce({ engineHours: 5670 });
    await addMeterReading(
      'eq_1',
      { engineHours: 5670, note: 'Снято при осмотре DAILY' },
      { tenantId: 'orion' },
    );
    expect(createReadingMock).toHaveBeenCalledTimes(1);
  });
});

describe('deleteMeterReading', () => {
  beforeEach(() => {
    findUniqueReadingMock.mockReset();
    deleteReadingMock.mockReset();
    executeRawMock.mockReset();
    findUniqueReadingMock.mockResolvedValue({ id: 'rd_1', equipmentId: 'eq_1', tenantId: 'orion' });
  });

  it('пересчитывает кэш наработки по последнему из оставшихся показаний в той же транзакции', async () => {
    await deleteMeterReading('eq_1', 'rd_1', { tenantId: 'orion' });
    expect(deleteReadingMock).toHaveBeenCalledWith({ where: { id: 'rd_1' } });
    const [lock, sync] = executeRawMock.mock.calls;
    expect(sqlOf(lock)).toMatch(/FOR UPDATE/);
    const sql = sqlOf(sync);
    expect(sql).toMatch(/SELECT m\."engineHours" FROM "MeterReading" m/);
    expect(sql).toMatch(/ORDER BY m\."recordedAt" DESC, m\."createdAt" DESC/);
    expect(sql).not.toMatch(/MAX\(/);
    expect(sync.slice(1)).toEqual(['eq_1', 'orion', 'eq_1', 'orion']);
  });

  it('чужое показание (другой tenant) не удаляет', async () => {
    findUniqueReadingMock.mockResolvedValue({ id: 'rd_1', equipmentId: 'eq_1', tenantId: 'other' });
    await expect(deleteMeterReading('eq_1', 'rd_1', { tenantId: 'orion' })).rejects.toThrow();
    expect(deleteReadingMock).not.toHaveBeenCalled();
    expect(executeRawMock).not.toHaveBeenCalled();
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
