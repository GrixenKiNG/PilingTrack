import {beforeEach, describe, expect, it, vi} from 'vitest';

const {
  permitFindMany, permitUpdateMany, shiftFindMany, shiftUpdateMany,
  equipmentFindMany, outboxCreateMany, auditCreate, chainUpdateMany,
} = vi.hoisted(() => ({
  permitFindMany: vi.fn(),
  permitUpdateMany: vi.fn(),
  shiftFindMany: vi.fn(),
  shiftUpdateMany: vi.fn(),
  equipmentFindMany: vi.fn(),
  outboxCreateMany: vi.fn(),
  auditCreate: vi.fn(),
  chainUpdateMany: vi.fn(),
}));

vi.mock('@/lib/db', () => {
  const tx = {
    // Обёртка ставит GUC и перечитывает его: без этого шесть таблиц
    // техготовности отдали бы планировщику пустые выборки.
    $executeRaw: vi.fn(async () => 1),
    // Один мок обслуживает два запроса: проверку организации в обёртке
    // (`tenant_id`) и взятие головы цепочки аудита (`lastSequence`/`headHash`).
    // Каждый читает своё поле.
    $queryRaw: vi.fn(async () => [{tenant_id: 'orion', lastSequence: BigInt(0), headHash: null}]),
    workPermit: {findMany: permitFindMany, updateMany: permitUpdateMany},
    shift: {findMany: shiftFindMany, updateMany: shiftUpdateMany},
    equipment: {findMany: equipmentFindMany},
    outboxEvent: {createMany: outboxCreateMany},
    auditLog: {create: auditCreate},
    tenantAuditChain: {updateMany: chainUpdateMany},
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
    permitFindMany.mockReset();
    permitUpdateMany.mockReset();
    shiftFindMany.mockReset();
    shiftUpdateMany.mockReset();
    permitFindMany.mockResolvedValue([]);
    permitUpdateMany.mockResolvedValue({count: 0});
    shiftFindMany.mockResolvedValue([]);
    shiftUpdateMany.mockResolvedValue({count: 0});
    equipmentFindMany.mockReset();
    outboxCreateMany.mockReset();
    equipmentFindMany.mockResolvedValue([]);
    outboxCreateMany.mockResolvedValue({count: 1});
    auditCreate.mockReset();
    chainUpdateMany.mockReset();
    auditCreate.mockResolvedValue({});
    chainUpdateMany.mockResolvedValue({count: 1});
  });

  it('истекают только согласованные наряды с прошедшим сроком', async () => {
    await runReadinessScheduler('orion', NOW);
    // Отбор переехал в выборку: обновляем потом по идентификаторам, чтобы
    // знать, какие именно строки поменяли, и записать это в аудит.
    const where = permitFindMany.mock.calls[0][0].where;
    expect(where).toEqual({tenantId: 'orion', state: 'APPROVED', validTo: {lte: NOW}});
  });

  // Автопереход — единственное изменение состояния без человека. Без записи в
  // цепочку разбор «кто просрочил наряд» упирался в пустоту.
  it('истёкший наряд оставляет событие в цепочке аудита', async () => {
    permitFindMany.mockResolvedValue([
      {id: 'permit-1', version: 3, state: 'APPROVED', validTo: new Date('2026-08-15T08:00:00.000Z')},
    ]);
    permitUpdateMany.mockResolvedValue({count: 1});

    const result = await runReadinessScheduler('orion', NOW);

    expect(permitUpdateMany.mock.calls[0][0].where.id).toEqual({in: ['permit-1']});
    expect(permitUpdateMany.mock.calls[0][0].data.state).toBe('EXPIRED');
    expect(result.permitsExpired).toBe(1);

    const event = auditCreate.mock.calls[0][0].data;
    expect(event.action).toBe('work-permit.expired');
    expect(event.entityType).toBe('WorkPermit');
    expect(event.entityId).toBe('permit-1');
    // Автора-человека нет, но роль и исполнитель обязаны быть названы.
    expect(event.userRole).toBe('SYSTEM');
    expect(event.userId).toBeNull();
    expect(event.userName).toBe('Планировщик техготовности');
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
      {id: 'yesterday', productionDate: new Date('2026-08-14T00:00:00.000Z'), timezone: MSK, version: 5, state: 'STARTED'},
      {id: 'today', productionDate: new Date('2026-08-15T00:00:00.000Z'), timezone: MSK, version: 1, state: 'STARTED'},
    ]);
    shiftUpdateMany.mockResolvedValue({count: 1});

    const result = await runReadinessScheduler('orion', NOW);

    const call = shiftUpdateMany.mock.calls[0][0];
    expect(call.where.id).toEqual({in: ['yesterday']});
    expect(call.data.state).toBe('CLOSED');
    expect(call.data.autoClosedAt).toEqual(NOW);
    expect(result.shiftsAutoClosed).toBe(1);

    // Смена закрыта без отчёта, послесменного осмотра и передачи — это должно
    // быть видно при разборе, а не только по колонке autoClosedAt.
    const event = auditCreate.mock.calls[0][0].data;
    expect(event.action).toBe('shift.auto-closed');
    expect(event.entityType).toBe('Shift');
    expect(event.entityId).toBe('yesterday');
    expect(event.userRole).toBe('SYSTEM');
    expect(auditCreate).toHaveBeenCalledTimes(1); // только просроченная, не сегодняшняя
  });

  // Закрывать автоматически можно только идущую смену. Смена, ждущая приёмки,
  // держит непринятую передачу: закрыв её, мы делаем передачу непринимаемой
  // навсегда — приёмка требует от смены состояния HANDOVER_PENDING.
  it('трогает только идущие смены — ни план, ни ждущую приёмки', async () => {
    await runReadinessScheduler('orion', NOW);
    expect(shiftFindMany.mock.calls[0][0].where.state).toEqual({in: ['STARTED']});
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
