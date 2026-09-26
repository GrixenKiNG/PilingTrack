import { describe, it, expect } from 'vitest';
import {
  computeDashboardKpis,
  type DashboardAnalyticsRow,
  type DashboardFleetTotals,
  type DashboardRigHours,
} from '../dashboard-kpis';

const rig = (
  id: string, engineHoursTotal: number | null, nextMaintenanceAtHours: number | null,
): DashboardRigHours => ({ id, engineHoursTotal, nextMaintenanceAtHours });

function row(over: Partial<DashboardAnalyticsRow>): DashboardAnalyticsRow {
  return {
    actualPiles: 0, actualPileMeters: 0, plannedPiles: 0, plannedPileMeters: 0,
    actualDrillingCount: 0, actualDrilling: 0, plannedDrillingCount: 0, plannedDrilling: 0,
    totalDowntime: 0, totalReports: 0,
    ...over,
  };
}

const fleet: DashboardFleetTotals = {
  activeToday: 3, workingNow: 2, expected: 2, totalEquipment: 10, crewsOnShiftToday: 4,
};

describe('computeDashboardKpis', () => {
  it('sums analytics rows and derives site counts', () => {
    const k = computeDashboardKpis(
      [
        row({ actualPiles: 5, actualPileMeters: 60.5, totalReports: 2, totalDowntime: 1.5 }),
        row({ actualPiles: 3, actualPileMeters: 30, totalReports: 0, totalDowntime: 0.5 }),
      ],
      null,
      new Map(),
      [],
    );
    expect(k.actualPiles).toBe(8);
    expect(k.actualPileMeters).toBe(90.5);
    expect(k.reports).toBe(2);
    expect(k.downtime).toBe(2);
    expect(k.sitesTotal).toBe(2);
    expect(k.sitesActive).toBe(1); // only the row with totalReports > 0
  });

  it('treats null totalDowntime as zero', () => {
    const k = computeDashboardKpis([row({ totalDowntime: null }), row({ totalDowntime: 4 })], null, new Map(), []);
    expect(k.downtime).toBe(4);
  });

  it('reads today/rig/crew counts from fleet totals', () => {
    const k = computeDashboardKpis([], fleet, new Map(), []);
    expect(k.shiftsDone).toBe(3); // машин с отчётом за сегодня — не смен (F-R35-3)
    // «В работе» — открытая смена, а не сданный отчёт. Раньше сюда шло
    // activeToday, и плитка показывала ноль, пока смена шла без отчёта.
    expect(k.rigsWorking).toBe(2);
    expect(k.reportsExpected).toBe(5); // activeToday + expected
    expect(k.rigsTotal).toBe(10);
    expect(k.crews).toBe(4);
  });

  it('returns null rig/crew KPIs when fleet is null (парк не загрузился, не «0 в работе»)', () => {
    const k = computeDashboardKpis([], null, new Map(), []);
    expect(k).toMatchObject({ shiftsDone: 0, reportsExpected: 0, rigsWorking: null, rigsTotal: null, crews: null });
  });

  it('returns null toRisk when the maintenance list failed to load (не «рисков нет»)', () => {
    const maint = new Map([['a', { repair: true, overdue: false }]]);
    expect(computeDashboardKpis([], fleet, maint, [], true).toRisk).toBeNull();
    // Данные загрузились — риск считается как раньше.
    expect(computeDashboardKpis([], fleet, maint, [], false).toRisk).toBe(1);
  });

  it('counts rigs at maintenance risk (repair OR overdue)', () => {
    const maint = new Map([
      ['a', { repair: true, overdue: false }],
      ['b', { repair: false, overdue: true }],
      ['c', { repair: false, overdue: false }],
    ]);
    expect(computeDashboardKpis([], fleet, maint, []).toRisk).toBe(2);
  });

  it('counts a rig whose engine hours passed the maintenance limit', () => {
    const rigs = [
      rig('a', 1400, 1300), // перепробег на 100 м/ч
      rig('b', 1200, 1300), // предел ещё не достигнут
      rig('c', 1300, 1300), // ровно предел — это не перепробег
    ];
    expect(computeDashboardKpis([], fleet, new Map(), rigs).toRisk).toBe(1);
  });

  it('ignores rigs with unknown hours or no limit set', () => {
    const rigs = [
      rig('a', null, 1300),
      rig('b', 1400, null),
      rig('c', null, null),
    ];
    expect(computeDashboardKpis([], fleet, new Map(), rigs).toRisk).toBe(0);
  });

  it('counts a rig once when it is both in repair and over its hour limit', () => {
    const maint = new Map([['a', { repair: true, overdue: false }]]);
    expect(computeDashboardKpis([], fleet, maint, [rig('a', 1400, 1300)]).toRisk).toBe(1);
  });

  it('unions both sources of risk', () => {
    const maint = new Map([['a', { repair: true, overdue: false }]]);
    const rigs = [rig('a', 1200, 1300), rig('b', 1400, 1300)];
    expect(computeDashboardKpis([], fleet, maint, rigs).toRisk).toBe(2);
  });
});
