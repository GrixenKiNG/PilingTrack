import { describe, it, expect } from 'vitest';
import { sortMaintenanceRecords, type MaintenanceRow } from '../equipment-maintenance';

function row(p: Pick<MaintenanceRow, 'id'> & Partial<MaintenanceRow>): MaintenanceRow {
  return {
    type: 'TO1',
    status: 'DONE',
    priority: 'NORMAL',
    title: `Запись ${p.id}`,
    description: '',
    scheduledAt: null,
    completedAt: null,
    engineHoursAtService: null,
    cost: null,
    performedBy: null,
    assigneeId: null,
    ...p,
  };
}

describe('sortMaintenanceRecords', () => {
  it('выводит записи по дате от новых к старым', () => {
    const sorted = sortMaintenanceRecords([
      row({ id: 'a', scheduledAt: '2026-07-01T00:00:00.000Z' }),
      row({ id: 'b', scheduledAt: '2026-09-19T00:00:00.000Z' }),
      row({ id: 'c', scheduledAt: '2026-08-10T00:00:00.000Z' }),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });

  it('предпочитает дату выполнения плановой', () => {
    const sorted = sortMaintenanceRecords([
      row({ id: 'plan-late', scheduledAt: '2026-09-19T00:00:00.000Z', completedAt: '2026-07-01T00:00:00.000Z' }),
      row({ id: 'plan-early', scheduledAt: '2026-07-01T00:00:00.000Z', completedAt: '2026-08-10T00:00:00.000Z' }),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(['plan-early', 'plan-late']);
  });

  it('записи без даты уходят в конец', () => {
    const sorted = sortMaintenanceRecords([
      row({ id: 'no-date' }),
      row({ id: 'dated', scheduledAt: '2026-08-10T00:00:00.000Z' }),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(['dated', 'no-date']);
  });

  it('не меняет исходный массив', () => {
    const input = [
      row({ id: 'a', scheduledAt: '2026-07-01T00:00:00.000Z' }),
      row({ id: 'b', scheduledAt: '2026-09-19T00:00:00.000Z' }),
    ];
    sortMaintenanceRecords(input);
    expect(input.map((r) => r.id)).toEqual(['a', 'b']);
  });
});
