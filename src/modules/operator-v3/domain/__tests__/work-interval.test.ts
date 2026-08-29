import {describe, expect, it} from 'vitest';
import {
  finishWorkInterval,
  startWorkInterval,
  WorkIntervalError,
  type StartWorkIntervalInput,
} from '../work-interval';

const base = (overrides: Partial<StartWorkIntervalInput> = {}): StartWorkIntervalInput => ({
  id: 'interval-1',
  tenantId: 'tenant-1',
  shiftId: 'shift-1',
  clientCommandId: 'command-1',
  kind: 'BREAK',
  shiftState: 'ACTIVE',
  workAllowed: true,
  startedAt: new Date('2026-08-27T08:00:00.000Z'),
  receivedAt: new Date('2026-08-27T08:00:01.000Z'),
  ...overrides,
});

describe('производственный интервал operator/v3', () => {
  it('создаёт открытый перерыв в активной разрешённой смене', () => {
    const interval = startWorkInterval(base(), []);

    expect(interval).toMatchObject({kind: 'BREAK', status: 'OPEN', durationSeconds: null, version: 1});
  });

  it.each([
    [{shiftState: 'PREPARING'}, 'SHIFT_NOT_ACTIVE'],
    [{workAllowed: false}, 'WORK_NOT_ALLOWED'],
  ] as const)('запрещает начало вне допустимой работы', (override, code) => {
    expect(() => startWorkInterval(base(override), [])).toThrowError(
      expect.objectContaining<Partial<WorkIntervalError>>({code}),
    );
  });

  it('запрещает пересечение открытых интервалов', () => {
    expect(() => startWorkInterval(base(), [{id: 'existing', status: 'OPEN'}])).toThrowError(
      expect.objectContaining<Partial<WorkIntervalError>>({code: 'INTERVAL_ALREADY_OPEN'}),
    );
  });

  it.each([
    [{category: 'Поломка'}, 'DOWNTIME_REASON_REQUIRED'],
    [{reason: 'Ожидание ремонта'}, 'DOWNTIME_CATEGORY_REQUIRED'],
  ] as const)('требует причину и категорию простоя', (fields, code) => {
    expect(() => startWorkInterval(base({kind: 'DOWNTIME', ...fields}), [])).toThrowError(
      expect.objectContaining<Partial<WorkIntervalError>>({code}),
    );
  });

  it('вычисляет длительность при завершении', () => {
    const interval = startWorkInterval(base(), []);
    const closed = finishWorkInterval(interval, new Date('2026-08-27T08:15:30.000Z'));

    expect(closed).toMatchObject({status: 'CLOSED', durationSeconds: 930, version: 2});
  });

  it('не позволяет завершить интервал второй раз или раньше начала', () => {
    const interval = startWorkInterval(base(), []);
    expect(() => finishWorkInterval(interval, new Date('2026-08-27T07:59:59.000Z'))).toThrowError(
      expect.objectContaining<Partial<WorkIntervalError>>({code: 'INVALID_INTERVAL_TIME'}),
    );
    const closed = finishWorkInterval(interval, new Date('2026-08-27T08:01:00.000Z'));
    expect(() => finishWorkInterval(closed, new Date('2026-08-27T08:02:00.000Z'))).toThrowError(
      expect.objectContaining<Partial<WorkIntervalError>>({code: 'INTERVAL_ALREADY_CLOSED'}),
    );
  });
});
