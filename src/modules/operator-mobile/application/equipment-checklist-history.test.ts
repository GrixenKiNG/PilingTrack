import {beforeEach, describe, expect, it, vi} from 'vitest';

const database = vi.hoisted(() => ({
  operatorChecklistExecution: {findMany: vi.fn()},
  operatorChecklistAnswerRecord: {groupBy: vi.fn(), findMany: vi.fn()},
  user: {findMany: vi.fn()},
}));
vi.mock('@/lib/db', () => ({db: database}));
import {listEquipmentChecklistHistory} from './equipment-checklist-history';

const done = new Date('2026-10-09T04:37:22.000Z');

beforeEach(() => {
  Object.values(database).forEach((model) => Object.values(model).forEach((fn) => fn.mockReset()));
  database.user.findMany.mockResolvedValue([{id: 'u1', name: 'Иванов И.'}]);
  database.operatorChecklistAnswerRecord.findMany.mockResolvedValue([]);
});

describe('история чек-листов машиниста по установке', () => {
  it('берёт только завершённые ЕО и предсменный осмотр этой установки, свежие первыми', async () => {
    database.operatorChecklistExecution.findMany.mockResolvedValue([]);
    database.operatorChecklistAnswerRecord.groupBy.mockResolvedValue([]);

    await listEquipmentChecklistHistory({tenantId: 't', equipmentId: 'eq-1', limit: 20});

    const args = database.operatorChecklistExecution.findMany.mock.calls[0][0];
    expect(args.where).toEqual({
      tenantId: 't', equipmentId: 'eq-1', status: 'COMPLETED',
      template: {templateKey: {in: ['EO_BEFORE', 'EO_AFTER', 'PRESHIFT_INSPECTION']}},
    });
    expect(args.orderBy).toEqual({completedAt: 'desc'});
    expect(args.take).toBe(20);
  });

  it('считает ответы по результатам, подписывает вид и исполнителя', async () => {
    database.operatorChecklistExecution.findMany.mockResolvedValue([
      {id: 'e1', shiftId: 's1', startedById: 'u1', completedAt: done, template: {templateKey: 'EO_BEFORE'}},
      {id: 'e2', shiftId: 's1', startedById: 'u-gone', completedAt: done, template: {templateKey: 'PRESHIFT_INSPECTION'}},
    ]);
    database.operatorChecklistAnswerRecord.groupBy.mockResolvedValue([
      {executionId: 'e1', result: 'OK', _count: {_all: 8}},
      {executionId: 'e1', result: 'REMARK', _count: {_all: 1}},
      {executionId: 'e1', result: 'FAULT', _count: {_all: 1}},
    ]);

    const rows = await listEquipmentChecklistHistory({tenantId: 't', equipmentId: 'eq-1'});

    expect(rows[0]).toMatchObject({
      id: 'e1', label: 'ЕО до смены', performerName: 'Иванов И.', completedAt: done.toISOString(),
      counts: {ok: 8, remark: 1, fault: 1, na: 0},
    });
    expect(rows[1]).toMatchObject({label: 'Предсменный осмотр', performerName: null, counts: {ok: 0, remark: 0, fault: 0, na: 0}});
  });
  it('не считает «долил за смену» нормой: ответы пунктов topup-* в счёт не идут', async () => {
    database.operatorChecklistExecution.findMany.mockResolvedValue([
      {id: 'e1', shiftId: 's1', startedById: 'u1', completedAt: done, template: {templateKey: 'EO_AFTER'}},
    ]);
    database.operatorChecklistAnswerRecord.groupBy.mockResolvedValue([]);

    await listEquipmentChecklistHistory({tenantId: 't', equipmentId: 'eq-1'});

    const args = database.operatorChecklistAnswerRecord.groupBy.mock.calls[0][0];
    expect(args.where).toMatchObject({tenantId: 't', NOT: {itemId: {startsWith: 'topup-'}}});
  });

  it('показывает моточасы, остаток топлива и долив жидкостей, снятые машинистом', async () => {
    database.operatorChecklistExecution.findMany.mockResolvedValue([
      {id: 'e1', shiftId: 's1', startedById: 'u1', completedAt: done, template: {templateKey: 'EO_AFTER'}},
      {id: 'e2', shiftId: 's1', startedById: 'u1', completedAt: done, template: {templateKey: 'EO_BEFORE'}},
    ]);
    database.operatorChecklistAnswerRecord.groupBy.mockResolvedValue([]);
    database.operatorChecklistAnswerRecord.findMany.mockResolvedValue([
      {executionId: 'e1', itemId: 'meter-after', value: {engineHours: 108}},
      {executionId: 'e1', itemId: 'fuel-level', value: {fuelPercent: 62}},
      {executionId: 'e1', itemId: 'topup-coolant', value: {coolantL: 2}},
      {executionId: 'e1', itemId: 'topup-hydraulic', value: {hydraulicOilL: 5}},
      {executionId: 'e1', itemId: 'topup-engine-oil', value: {engineOilL: 3}},
      {executionId: 'e1', itemId: 'topup-diesel', value: {dieselL: 120}},
      {executionId: 'e1', itemId: 'topup-diesel', value: {unknownKey: 9}},
      // значения с чужих пунктов (мимо границ каталога) не показываются
      {executionId: 'e2', itemId: 'cab-glass', value: {engineHours: 999999, fuelPercent: 1290, dieselL: 99999}},
    ]);

    const rows = await listEquipmentChecklistHistory({tenantId: 't', equipmentId: 'eq-1'});

    expect(rows[0].readings).toEqual({
      engineHours: 108, fuelPercent: 62,
      topUps: {coolantL: 2, hydraulicOilL: 5, engineOilL: 3, dieselL: 120},
    });
    expect(rows[1].readings).toBeNull();
    const args = database.operatorChecklistAnswerRecord.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({tenantId: 't', executionId: {in: ['e1', 'e2']}});
  });
});
