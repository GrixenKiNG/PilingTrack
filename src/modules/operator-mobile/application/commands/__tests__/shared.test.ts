// @vitest-environment node
import {describe, expect, it, vi} from 'vitest';

vi.mock('@/modules/readiness/server', () => ({withReadinessTenantTransaction: vi.fn()}));

import {recordMeter, requirePileGrade} from '../shared';

/*
  АРХИВНАЯ МАРКА (решение владельца 26.09.2026): сваю по марке, которую убрали
  в архив, пока телефон был без связи, принимаем, если смена началась раньше
  архивации. Марку, архивированную до начала смены, — нет.
*/
const shiftStartedAt = new Date('2026-09-26T04:00:00.000Z');

function txWith(grade: object | null) {
  return {pileGrade: {findFirst: vi.fn().mockResolvedValue(grade)}} as never;
}

describe('requirePileGrade', () => {
  it('accepts an active grade', async () => {
    const tx = txWith({id: 'g1', lengthMm: 12000, isActive: true, archivedAt: null});
    await expect(requirePileGrade(tx, 'tenant-a', 'g1', shiftStartedAt)).resolves.toEqual({id: 'g1', lengthMm: 12000});
  });

  it('accepts a grade archived after the shift started', async () => {
    const tx = txWith({id: 'g1', lengthMm: 12000, isActive: false, archivedAt: new Date('2026-09-26T09:00:00.000Z')});
    await expect(requirePileGrade(tx, 'tenant-a', 'g1', shiftStartedAt)).resolves.toEqual({id: 'g1', lengthMm: 12000});
  });

  it('rejects a grade archived before the shift started', async () => {
    const tx = txWith({id: 'g1', lengthMm: 12000, isActive: false, archivedAt: new Date('2026-09-25T09:00:00.000Z')});
    await expect(requirePileGrade(tx, 'tenant-a', 'g1', shiftStartedAt)).rejects.toThrow('убрана в архив — обновите экран');
  });

  it('rejects a grade archived with no recorded time', async () => {
    const tx = txWith({id: 'g1', lengthMm: 12000, isActive: false, archivedAt: null});
    await expect(requirePileGrade(tx, 'tenant-a', 'g1', shiftStartedAt)).rejects.toThrow('убрана в архив — обновите экран');
  });

  it('rejects a grade of another organization', async () => {
    await expect(requirePileGrade(txWith(null), 'tenant-a', 'g1', shiftStartedAt))
      .rejects.toThrow('не найдена в справочнике вашей организации — обновите экран и выберите марку заново');
  });
});

describe('recordMeter — замена счётчика', () => {
  const input = {
    tenantId: 'tenant-a', equipmentId: 'eq-1', engineHours: 99,
    operatorId: 'operator-a', note: 'ЕО после работы', now: new Date('2026-10-07T16:00:00Z'),
  };

  function meterTx(previous: number | null, cached: number | null) {
    return {
      meterReading: {
        findFirst: vi.fn().mockResolvedValue(previous === null ? null : {engineHours: previous}),
        create: vi.fn().mockResolvedValue({id: 'meter-1'}),
      },
      equipment: {
        findFirst: vi.fn().mockResolvedValue({engineHoursTotal: cached}),
        update: vi.fn().mockResolvedValue({}),
      },
    };
  }

  it('без пометки не принимает меньшее показание и ничего не пишет', async () => {
    const tx = meterTx(3000, 3000);
    await expect(recordMeter(tx as never, input)).rejects.toMatchObject({status: 400});
    expect(tx.meterReading.create).not.toHaveBeenCalled();
    expect(tx.equipment.update).not.toHaveBeenCalled();
  });

  it('принимает заменённый счётчик с меньшим показанием и сохраняет пометку', async () => {
    const tx = meterTx(3000, 3000);
    await recordMeter(tx as never, {...input, meterReplaced: true});
    expect(tx.meterReading.create).toHaveBeenCalledWith({data: expect.objectContaining({
      engineHours: 99, note: 'Счётчик заменён; ЕО после работы',
    })});
    expect(tx.equipment.update).toHaveBeenCalledWith({
      where: {tenantId_id: {tenantId: 'tenant-a', id: 'eq-1'}},
      data: {engineHoursTotal: 99},
    });
    tx.meterReading.findFirst.mockResolvedValue({engineHours: 99});
    tx.equipment.findFirst.mockResolvedValue({engineHoursTotal: 99});
    await recordMeter(tx as never, {...input, engineHours: 100});
    expect(tx.equipment.update).toHaveBeenLastCalledWith(expect.objectContaining({data: {engineHoursTotal: 100}}));
  });

  it('не требует большой цифры при пустом журнале и замене счётчика в карточке', async () => {
    const tx = meterTx(null, 3000);
    await recordMeter(tx as never, {...input, meterReplaced: true});
    expect(tx.equipment.update).toHaveBeenCalledWith(expect.objectContaining({data: {engineHoursTotal: 99}}));
  });

  it('не дублирует уже переданную пометку замены', async () => {
    const tx = meterTx(3000, 3000);
    await recordMeter(tx as never, {...input, note: 'Счётчик заменён; ЕО после работы', meterReplaced: true});
    expect(tx.meterReading.create).toHaveBeenCalledWith({data: expect.objectContaining({note: 'Счётчик заменён; ЕО после работы'})});
  });
});
