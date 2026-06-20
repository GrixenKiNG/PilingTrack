import { describe, it, expect } from 'vitest';
import {
  computeDashboardKpis,
  type DashboardAnalyticsRow,
  type DashboardFleetTotals,
} from '../dashboard-kpis';

function row(over: Partial<DashboardAnalyticsRow>): DashboardAnalyticsRow {
  return {
    actualPiles: 0, actualPileMeters: 0, plannedPiles: 0, plannedPileMeters: 0,
    actualDrillingCount: 0, actualDrilling: 0, plannedDrillingCount: 0, plannedDrilling: 0,
    totalDowntime: 0, totalReports: 0,
    ...over,
  };
}

const fleet: DashboardFleetTotals = { activeToday: 3, expected: 2, totalEquipment: 10, crewsOnShiftToday: 4 };

describe('computeDashboardKpis', () => {
  it('sums analytics rows and derives site counts', () => {
    const k = computeDashboardKpis(
      [
        row({ actualPiles: 5, actualPileMeters: 60.5, totalReports: 2, totalDowntime: 1.5 }),
        row({ actualPiles: 3, actualPileMeters: 30, totalReports: 0, totalDowntime: 0.5 }),
      ],
      null,
      new Map(),
    );
    expect(k.actualPiles).toBe(8);
    expect(k.actualPileMeters).toBe(90.5);
    expect(k.reports).toBe(2);
    expect(k.downtime).toBe(2);
    expect(k.sitesTotal).toBe(2);
    expect(k.sitesActive).toBe(1); // only the row with totalReports > 0
  });

  it('treats null totalDowntime as zero', () => {
    const k = computeDashboardKpis([row({ totalDowntime: null }), row({ totalDowntime: 4 })], null, new Map());
    expect(k.downtime).toBe(4);
  });

  it('reads shift/rig/crew counts from fleet totals', () => {
    const k = computeDashboardKpis([], fleet, new Map());
    expect(k.shiftsDone).toBe(3);
    expect(k.rigsWorking).toBe(3);
    expect(k.reportsExpected).toBe(5); // activeToday + expected
    expect(k.rigsTotal).toBe(10);
    expect(k.crews).toBe(4);
  });

  it('defaults fleet-derived KPIs to zero when fleet is null', () => {
    const k = computeDashboardKpis([], null, new Map());
    expect(k).toMatchObject({ shiftsDone: 0, reportsExpected: 0, rigsWorking: 0, rigsTotal: 0, crews: 0 });
  });

  it('counts rigs at maintenance risk (repair OR overdue)', () => {
    const maint = new Map([
      ['a', { repair: true, overdue: false }],
      ['b', { repair: false, overdue: true }],
      ['c', { repair: false, overdue: false }],
    ]);
    expect(computeDashboardKpis([], fleet, maint).toRisk).toBe(2);
  });
});
