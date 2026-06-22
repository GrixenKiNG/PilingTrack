import { describe, it, expect } from 'vitest';
import {
  isOpenRecord,
  isOverdue,
  hoursUntilMaintenance,
  currentHours,
  maintenanceInterval,
  deadlineText,
  quickFilterMatches,
  uniqueEquipmentCount,
  maintenanceCompletionPercent,
  splitSiteName,
  visiblePageNumbers,
  computeBoardStats,
  type WorkOrderLike,
} from '../work-order-logic';

const NOW = new Date('2026-06-20T12:00:00'); // local noon → day math is timezone-stable

function wo(over: Partial<WorkOrderLike>): WorkOrderLike {
  return {
    status: 'PLANNED', type: 'TO1', priority: 'NORMAL',
    scheduledAt: null, assigneeId: null, faultCause: null,
    equipmentId: 'e1', engineHoursAtService: null,
    equipment: { engineHoursTotal: null, nextMaintenanceAtHours: null },
    ...over,
  };
}

describe('predicates', () => {
  it('isOpenRecord = status in the open set', () => {
    expect(isOpenRecord(wo({ status: 'IN_PROGRESS' }))).toBe(true);
    expect(isOpenRecord(wo({ status: 'DONE' }))).toBe(false);
  });

  it('isOverdue requires a past schedule AND an open status', () => {
    expect(isOverdue(wo({ scheduledAt: '2026-06-18T09:00:00', status: 'ASSIGNED' }), NOW)).toBe(true);
    expect(isOverdue(wo({ scheduledAt: '2026-06-18T09:00:00', status: 'DONE' }), NOW)).toBe(false); // closed
    expect(isOverdue(wo({ scheduledAt: '2026-06-25T09:00:00', status: 'ASSIGNED' }), NOW)).toBe(false); // future
    expect(isOverdue(wo({ scheduledAt: null }), NOW)).toBe(false);
  });
});

describe('engine-hour helpers', () => {
  it('hoursUntilMaintenance = next - total, or null if either missing', () => {
    expect(hoursUntilMaintenance(wo({ equipment: { engineHoursTotal: 800, nextMaintenanceAtHours: 1000 } }))).toBe(200);
    expect(hoursUntilMaintenance(wo({ equipment: { engineHoursTotal: null, nextMaintenanceAtHours: 1000 } }))).toBeNull();
  });
  it('currentHours prefers the record reading, falls back to the rig total', () => {
    expect(currentHours(wo({ engineHoursAtService: 950, equipment: { engineHoursTotal: 800, nextMaintenanceAtHours: null } }))).toBe(950);
    expect(currentHours(wo({ engineHoursAtService: null, equipment: { engineHoursTotal: 800, nextMaintenanceAtHours: null } }))).toBe(800);
  });
  it('maintenanceInterval = the rig next-maintenance hours or null', () => {
    expect(maintenanceInterval(wo({ equipment: { engineHoursTotal: null, nextMaintenanceAtHours: 1000 } }))).toBe(1000);
    expect(maintenanceInterval(wo({ equipment: null }))).toBeNull();
  });
});

describe('deadlineText', () => {
  it('renders the Russian phrase for the scheduled date', () => {
    expect(deadlineText(wo({ scheduledAt: '2026-06-18T09:00:00' }), NOW)).toBe('просрочено');
    expect(deadlineText(wo({ scheduledAt: '2026-06-21T09:00:00' }), NOW)).toBe('завтра');
    expect(deadlineText(wo({ scheduledAt: null }), NOW)).toBe('срок не задан');
  });
});

describe('quickFilterMatches', () => {
  const overdueOpen = wo({ scheduledAt: '2026-06-18T09:00:00', status: 'ASSIGNED' });
  it('all → always true', () => {
    expect(quickFilterMatches(wo({ status: 'DONE' }), 'all', NOW)).toBe(true);
  });
  it('requires → open records', () => {
    expect(quickFilterMatches(wo({ status: 'ASSIGNED' }), 'requires', NOW)).toBe(true);
    expect(quickFilterMatches(wo({ status: 'DONE' }), 'requires', NOW)).toBe(false);
  });
  it('overdue → overdue records', () => {
    expect(quickFilterMatches(overdueOpen, 'overdue', NOW)).toBe(true);
  });
  it('repair → repair types or on-hold', () => {
    expect(quickFilterMatches(wo({ type: 'REPAIR' }), 'repair', NOW)).toBe(true);
    expect(quickFilterMatches(wo({ status: 'ON_HOLD' }), 'repair', NOW)).toBe(true);
  });
  it('unassigned → open with no assignee', () => {
    expect(quickFilterMatches(wo({ status: 'ASSIGNED', assigneeId: null }), 'unassigned', NOW)).toBe(true);
    expect(quickFilterMatches(wo({ status: 'ASSIGNED', assigneeId: 'u1' }), 'unassigned', NOW)).toBe(false);
  });
  it('issues → high/critical priority, overdue, or has a fault cause', () => {
    expect(quickFilterMatches(wo({ priority: 'CRITICAL' }), 'issues', NOW)).toBe(true);
    expect(quickFilterMatches(wo({ faultCause: 'утечка масла' }), 'issues', NOW)).toBe(true);
    expect(quickFilterMatches(wo({ priority: 'NORMAL' }), 'issues', NOW)).toBe(false);
  });
});

describe('aggregations', () => {
  it('uniqueEquipmentCount counts distinct rigs', () => {
    expect(uniqueEquipmentCount([wo({ equipmentId: 'a' }), wo({ equipmentId: 'a' }), wo({ equipmentId: 'b' })])).toBe(2);
  });
  it('maintenanceCompletionPercent = done / (non-cancelled), rounded', () => {
    expect(maintenanceCompletionPercent([
      wo({ status: 'DONE' }), wo({ status: 'DONE' }), wo({ status: 'PLANNED' }), wo({ status: 'CANCELLED' }),
    ])).toBe(67); // 2 done of 3 planned
    expect(maintenanceCompletionPercent([])).toBe(0);
  });

  it('computeBoardStats rolls up per-rig KPIs', () => {
    const stats = computeBoardStats([
      wo({ equipmentId: 'a', type: 'TO1', status: 'ASSIGNED' }),                                  // requires
      wo({ equipmentId: 'b', type: 'TO2', status: 'ASSIGNED', scheduledAt: '2026-06-18T09:00:00' }), // requires + overdue
      wo({ equipmentId: 'c', type: 'REPAIR', status: 'IN_PROGRESS' }),                             // in repair
      wo({ equipmentId: 'd', status: 'DONE' }),                                                    // closed
    ], 4, NOW);
    expect(stats).toEqual({ equipment: 4, open: 2, overdue: 1, inRepair: 1, readiness: 25 });
  });
});

describe('string / paging helpers', () => {
  it('splitSiteName handles parens, commas and plain names', () => {
    expect(splitSiteName('ЖК Север (3-я очередь)')).toEqual({ title: 'ЖК Север', location: '3-я очередь' });
    expect(splitSiteName('ЖК Север, корпус 2')).toEqual({ title: 'ЖК Север', location: 'корпус 2' });
    expect(splitSiteName('ЖК Север')).toEqual({ title: 'ЖК Север', location: null });
    expect(splitSiteName('')).toEqual({ title: 'Без объекта', location: null });
  });
  it('visiblePageNumbers returns all pages when ≤ 5, else a window of 5', () => {
    expect(visiblePageNumbers(1, 3)).toEqual([1, 2, 3]);
    expect(visiblePageNumbers(5, 10)).toEqual([3, 4, 5, 6, 7]);
    expect(visiblePageNumbers(1, 10)).toEqual([1, 2, 3, 4, 5]);
    expect(visiblePageNumbers(10, 10)).toEqual([6, 7, 8, 9, 10]);
  });
});
