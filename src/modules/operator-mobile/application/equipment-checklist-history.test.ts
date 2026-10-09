import {beforeEach, describe, expect, it, vi} from 'vitest';

const database = vi.hoisted(() => ({
  operatorChecklistExecution: {findMany: vi.fn()},
  operatorChecklistAnswerRecord: {groupBy: vi.fn()},
  user: {findMany: vi.fn()},
}));
vi.mock('@/lib/db', () => ({db: database}));
import {listEquipmentChecklistHistory} from './equipment-checklist-history';

const done = new Date('2026-10-09T04:37:22.000Z');

beforeEach(() => {
  Object.values(database).forEach((model) => Object.values(model).forEach((fn) => fn.mockReset()));
  database.user.findMany.mockResolvedValue([{id: 'u1', name: 'Иванов И.'}]);
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
});
