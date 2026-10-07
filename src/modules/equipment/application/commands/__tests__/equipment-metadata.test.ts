import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findFirstMock, updateMock, addReadingMock, recordInTxMock } = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  updateMock: vi.fn(),
  addReadingMock: vi.fn(),
  recordInTxMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: { equipment: { findFirst: findFirstMock, update: updateMock } },
}));
vi.mock('../meter-reading', () => ({
  addMeterReading: addReadingMock,
  recordMeterReadingInTx: recordInTxMock,
}));

import { updateEquipmentMetadata } from '../equipment-metadata';

const ctx = { tenantId: 'orion', actorId: 'user-1', allowDecrease: true };

describe('updateEquipmentMetadata — наработка (владелец 07.10.2026: «моточасы не сохраняются»)', () => {
  beforeEach(() => {
    findFirstMock.mockReset();
    updateMock.mockReset();
    addReadingMock.mockReset();
    recordInTxMock.mockReset();
    updateMock.mockResolvedValue({});
    addReadingMock.mockResolvedValue({ reading: { id: 'mr', engineHours: 3000, recordedAt: new Date() }, warning: null });
  });

  it('новая наработка (в том числе меньше прежней) пишется показанием, а не в карточку напрямую', async () => {
    findFirstMock.mockResolvedValue({ engineHoursTotal: 99999 });
    const wrote = await updateEquipmentMetadata('eq-1', { engineHoursTotal: 3000 }, ctx);

    expect(wrote).toBe(true);
    expect(addReadingMock).toHaveBeenCalledWith(
      'eq-1',
      expect.objectContaining({ engineHours: 3000 }),
      expect.objectContaining({ tenantId: 'orion', allowDecrease: true }),
    );
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('читает текущую наработку строго по организации', async () => {
    findFirstMock.mockResolvedValue({ engineHoursTotal: 100 });
    await updateEquipmentMetadata('eq-1', { engineHoursTotal: 200 }, ctx);
    expect(findFirstMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'eq-1', tenantId: 'orion' },
    }));
  });

  it('та же цифра, что уже стоит у установки, показания не создаёт — иначе устаревшая форма откатывает свежие показания оператора', async () => {
    findFirstMock.mockResolvedValue({ engineHoursTotal: 3000 });
    const wrote = await updateEquipmentMetadata('eq-1', { engineHoursTotal: 3000 }, ctx);

    expect(wrote).toBe(false);
    expect(addReadingMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('правка другого поля при той же наработке пишет только это поле', async () => {
    findFirstMock.mockResolvedValue({ engineHoursTotal: 3000 });
    const wrote = await updateEquipmentMetadata('eq-1', { engineHoursTotal: 3000, engineBrand: 'Cat' }, ctx);

    expect(wrote).toBe(true);
    expect(addReadingMock).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledWith({ where: { id: 'eq-1' }, data: { engineBrand: 'Cat' } });
  });

  it('очистка поля («наработка неизвестна») пишется напрямую и показанием не является', async () => {
    const wrote = await updateEquipmentMetadata('eq-1', { engineHoursTotal: null } as never, ctx);

    expect(wrote).toBe(true);
    expect(addReadingMock).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledWith({ where: { id: 'eq-1' }, data: { engineHoursTotal: null } });
  });

  it('внутри чужой транзакции показание идёт через recordMeterReadingInTx', async () => {
    const tx = { equipment: { findFirst: findFirstMock, update: updateMock } };
    findFirstMock.mockResolvedValue({ engineHoursTotal: 10 });
    recordInTxMock.mockResolvedValue({ reading: { id: 'mr', engineHours: 20, recordedAt: new Date() }, warning: null });

    await updateEquipmentMetadata('eq-1', { engineHoursTotal: 20 }, ctx, tx as never);

    expect(recordInTxMock).toHaveBeenCalledWith(tx, 'eq-1', expect.objectContaining({ engineHours: 20 }), expect.anything());
    expect(addReadingMock).not.toHaveBeenCalled();
  });
});
