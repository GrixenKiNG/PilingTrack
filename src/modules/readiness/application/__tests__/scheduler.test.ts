import {beforeEach, describe, expect, it, vi} from 'vitest';

const {permitUpdateMany, shiftFindMany, shiftUpdateMany, equipmentFindMany, outboxCreateMany} = vi.hoisted(() => ({
  permitUpdateMany: vi.fn(),
  shiftFindMany: vi.fn(),
  shiftUpdateMany: vi.fn(),
  equipmentFindMany: vi.fn(),
  outboxCreateMany: vi.fn(),
}));

vi.mock('@/lib/db', () => {
  const tx = {
    // Обёртка ставит GUC и перечитывает его: без этого шесть таблиц
    // техготовности отдали бы планировщику пустые выборки.
    $executeRaw: vi.fn(async () => 1),
    $queryRaw: vi.fn(async () => [{tenant_id: 'orion'}]),
    workPermit: {updateMany: permitUpdateMany},
    shift: {findMany: shiftFindMany, updateMany: shiftUpdateMany},
    equipment: {findMany: equipmentFindMany},
    outboxEvent: {createMany: outboxCreateMany},
  };
  return {
    db: {$transaction: (cb: (t: unknown) => unknown) => cb(tx)},
    DEFAULT_TX_OPTIONS: {},
  };
});

import {runReadinessScheduler} from '../scheduler';

const NOW = new Date('2026-08-15T09:00:00.000Z');
const MSK = 'Europe/Moscow';

describe('суточный сброс техготовности', () => {
  beforeEach(() => {
    permitUpdateMany.mockReset();
    shiftFindMany.mockReset();
    shiftUpdateMany.mockReset();
    permitUpdateMany.mockResolvedValue({count: 0});
    shiftFindMany.mockResolvedValue([]);
    shiftUpdateMany.mockResolvedValue({count: 0});
    equipmentFindMany.mockReset();
    outboxCreateMany.mockReset();
    equipmentFindMany.mockResolvedValue([]);
    outboxCreateMany.mockResolvedValue({count: 1});
  });

  it('истекают только согласованные наряды с прошедшим сроком', async () => {
    await runReadinessScheduler('orion', NOW);
    const where = permitUpdateMany.mock.calls[0][0].where;
    expect(where).toEqual({tenantId: 'orion', state: 'APPROVED', validTo: {lte: NOW}});
    expect(permitUpdateMany.mock.calls[0][0].data.state).toBe('EXPIRED');
  });

  // Главная защита: закрыть смену текущих суток — значит оборвать работу,
  // которая идёт прямо сейчас.
  it('сегодняшняя смена не закрывается', async () => {
    shiftFindMany.mockResolvedValue([
      {id: 'today', productionDate: new Date('2026-08-15T00:00:00.000Z'), timezone: MSK},
    ]);
    const result = await runReadinessScheduler('orion', NOW);
    expect(shiftUpdateMany).not.toHaveBeenCalled();
    expect(result.shiftsAutoClosed).toBe(0);
  });

  it('вчерашняя незакрытая смена закрывается с отметкой автозакрытия', async () => {
    shiftFindMany.mockResolvedValue([
      {id: 'yesterday', productionDate: new Date('2026-08-14T00:00:00.000Z'), timezone: MSK},
      {id: 'today', productionDate: new Date('2026-08-15T00:00:00.000Z'), timezone: MSK},
    ]);
    shiftUpdateMany.mockResolvedValue({count: 1});

    const result = await runReadinessScheduler('orion', NOW);

    const call = shiftUpdateMany.mock.calls[0][0];
    expect(call.where.id).toEqual({in: ['yesterday']});
    expect(call.data.state).toBe('CLOSED');
    expect(call.data.autoClosedAt).toEqual(NOW);
    expect(result.shiftsAutoClosed).toBe(1);
  });

  it('несостоявшиеся смены (запланирована, ждёт приёмки) не трогает', async () => {
    await runReadinessScheduler('orion', NOW);
    expect(shiftFindMany.mock.calls[0][0].where.state).toEqual({in: ['STARTED', 'HANDOVER_PENDING']});
  });
});

// Суточный пересчёт — лекарство от «вчерашних цифр на экране»: без него
// CurrentReadiness обновлялся только по событию, и утром показывал снимок
// позавчерашнего дня как сегодняшнее состояние.
describe('суточный пересчёт готовности', () => {
  beforeEach(() => {
    equipmentFindMany.mockResolvedValue([{id: 'eq_1'}, {id: 'eq_2'}]);
  });

  it('заказывает пересчёт на каждую активную машину', async () => {
    const result = await runReadinessScheduler('orion', NOW);
    expect(result.recalcRequested).toBe(2);
    expect(outboxCreateMany).toHaveBeenCalledTimes(2);
  });

  it('ключ дедупликации содержит производственные сутки — повтор в тот же день не задваивает', async () => {
    await runReadinessScheduler('orion', NOW);
    const keys = outboxCreateMany.mock.calls.map((call) => call[0].data[0].dedupeKey);
    expect(keys[0]).toContain('DAILY_RECALC');
    expect(keys[0]).toContain('2026-08-15');
    expect(outboxCreateMany.mock.calls[0][0].skipDuplicates).toBe(true);
  });
});
