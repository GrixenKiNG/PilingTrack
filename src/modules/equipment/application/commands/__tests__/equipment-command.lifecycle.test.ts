// @vitest-environment node
import {beforeEach, describe, expect, it, vi} from 'vitest';

/*
  Жизненный цикл установки: заведение, правка карточки, вывод из эксплуатации.

  Держится:
  - правка с `expectedUpdatedAt` — оптимистичная блокировка: чужая правка между
    чтением и сохранением даёт 409, а не молча затирается;
  - строка установки блокируется FOR UPDATE до сравнения версии;
  - метка `updatedAt` обязана продвинуться даже при двух сохранениях в один тик;
  - установка чужой организации не находится (404), вывод из эксплуатации тоже
    сверяет организацию;
  - события агрегата уходят в outbox с организацией явно.
*/
const h = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  outboxCreate: vi.fn(),
  queryRaw: vi.fn(),
  transaction: vi.fn(),
  repoFindById: vi.fn(),
  repoSave: vi.fn(),
  updateMetadata: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    $transaction: h.transaction,
    equipment: {findUnique: h.findUnique},
  },
}));
vi.mock('../../../infrastructure', () => ({
  getEquipmentRepository: () => ({findById: h.repoFindById, save: h.repoSave}),
}));
vi.mock('../equipment-metadata', () => ({updateEquipmentMetadata: h.updateMetadata}));

import {createEquipment, retireEquipment, updateEquipment} from '../equipment-command.service';
import {EquipmentAggregate} from '../../../domain';

const UPDATED_AT = new Date('2026-10-26T08:00:00.000Z');
const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'eq-1', name: 'LRH 100', model: 'Liebherr', qty: 1, description: '', isActive: true,
  tenantId: 'tenant-a', createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: UPDATED_AT, ...overrides,
});
const aggregate = () => EquipmentAggregate.reconstitute({
  id: 'eq-1', name: 'LRH 100', model: 'Liebherr', qty: 1, description: '', isActive: true,
  tenantId: 'tenant-a', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: UPDATED_AT.toISOString(),
});

beforeEach(() => {
  vi.clearAllMocks();
  h.findUnique.mockResolvedValue(row());
  h.queryRaw.mockResolvedValue([{id: 'eq-1'}]);
  h.transaction.mockImplementation(async (work: (client: unknown) => unknown) => work({
    $queryRaw: h.queryRaw,
    equipment: {findUnique: h.findUnique, update: h.update},
    outboxEvent: {create: h.outboxCreate},
  }));
});

describe('createEquipment', () => {
  it('сохраняет агрегат с организацией и возвращает строку из базы', async () => {
    h.findUnique.mockResolvedValue(row({name: 'КБУРГ'}));

    const created = await createEquipment({name: '  КБУРГ ', tenantId: 'tenant-a', userId: 'u-1'});

    const saved = h.repoSave.mock.calls[0][0] as EquipmentAggregate;
    expect(saved.getState()).toMatchObject({name: 'КБУРГ', tenantId: 'tenant-a', isActive: true, qty: 1});
    expect(saved.getPendingEvents()[0].type).toBe('EquipmentCreated');
    expect(created).toMatchObject({name: 'КБУРГ'});
  });

  it('пустое название не сохраняется', async () => {
    await expect(createEquipment({name: '   ', tenantId: 'tenant-a'})).rejects.toThrow('Укажите название установки');
    expect(h.repoSave).not.toHaveBeenCalled();
  });
});

describe('updateEquipment — без версии', () => {
  it('меняет через репозиторий и сохраняет', async () => {
    h.repoFindById.mockResolvedValue(aggregate());

    await updateEquipment({equipmentId: 'eq-1', tenantId: 'tenant-a', name: 'LRH 120', userId: 'u-1'});

    expect(h.repoFindById).toHaveBeenCalledWith('eq-1', 'tenant-a');
    const saved = h.repoSave.mock.calls[0][0] as EquipmentAggregate;
    expect(saved.getState().name).toBe('LRH 120');
    expect(h.transaction).not.toHaveBeenCalled();
  });

  it('установки нет или она чужая — 404 и без сохранения', async () => {
    h.repoFindById.mockResolvedValue(null);

    await expect(updateEquipment({equipmentId: 'eq-x', tenantId: 'tenant-a', name: 'X'}))
      .rejects.toMatchObject({status: 404});
    expect(h.repoSave).not.toHaveBeenCalled();
  });
});

describe('updateEquipment — с проверкой версии карточки', () => {
  const command = {
    equipmentId: 'eq-1', tenantId: 'tenant-a', name: 'LRH 120', userId: 'u-1',
    expectedUpdatedAt: UPDATED_AT.toISOString(),
  };

  it('версия совпала: строка заблокирована, карточка, паспорт и событие записаны в одной транзакции', async () => {
    await updateEquipment({...command, metadata: {}, allowDecrease: true});

    expect(h.queryRaw).toHaveBeenCalledTimes(1);
    expect(h.update.mock.calls[0][0]).toMatchObject({
      where: {id: 'eq-1', tenantId: 'tenant-a'}, data: {name: 'LRH 120', isActive: true},
    });
    expect(h.updateMetadata).toHaveBeenCalledWith(
      'eq-1', {}, {tenantId: 'tenant-a', actorId: 'u-1', allowDecrease: true}, expect.anything(),
    );
    expect(h.outboxCreate.mock.calls[0][0].data).toMatchObject({
      type: 'EquipmentUpdated', aggregateId: 'eq-1', aggregateType: 'Equipment', tenantId: 'tenant-a',
    });
  });

  it('метка updatedAt продвигается строго вперёд даже при сохранении в тот же тик', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(UPDATED_AT); // «сейчас» равно прежней метке
    try {
      await updateEquipment(command);
    } finally {
      vi.useRealTimers();
    }

    const stamp = h.update.mock.calls[1][0].data.updatedAt as Date;
    expect(stamp.getTime()).toBe(UPDATED_AT.getTime() + 1);
  });

  it('чужая правка между чтением и сохранением даёт 409, ничего не пишется', async () => {
    h.findUnique.mockResolvedValue(row({updatedAt: new Date('2026-10-26T08:00:05.000Z')}));

    await expect(updateEquipment(command)).rejects.toMatchObject({status: 409});
    expect(h.update).not.toHaveBeenCalled();
    expect(h.updateMetadata).not.toHaveBeenCalled();
    expect(h.outboxCreate).not.toHaveBeenCalled();
  });

  it('установка чужой организации не находится: 404', async () => {
    h.findUnique.mockResolvedValue(null);

    await expect(updateEquipment(command)).rejects.toMatchObject({status: 404});
    expect(h.findUnique.mock.calls[0][0].where).toEqual({id: 'eq-1', tenantId: 'tenant-a'});
    expect(h.update).not.toHaveBeenCalled();
  });
});

describe('retireEquipment', () => {
  it('выводит из эксплуатации: история остаётся, активность снята, событие в агрегате', async () => {
    h.repoFindById.mockResolvedValue(aggregate());

    await retireEquipment('eq-1', 'tenant-a', 'u-1');

    const saved = h.repoSave.mock.calls[0][0] as EquipmentAggregate;
    expect(saved.getState().isActive).toBe(false);
    expect(saved.getPendingEvents().map((event) => event.type)).toEqual(['EquipmentRetired']);
  });

  it('чужая или несуществующая установка: 404', async () => {
    h.repoFindById.mockResolvedValue(null);

    await expect(retireEquipment('eq-x', 'tenant-a')).rejects.toMatchObject({status: 404});
    expect(h.repoFindById).toHaveBeenCalledWith('eq-x', 'tenant-a');
    expect(h.repoSave).not.toHaveBeenCalled();
  });
});
