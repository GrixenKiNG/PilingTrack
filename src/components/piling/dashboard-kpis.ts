/**
 * Pure dispatcher-dashboard KPI aggregation. Extracted from admin-dashboard.tsx
 * so the headline numbers are unit-testable and not buried in a useMemo. Inputs
 * use minimal structural shapes (only the fields the KPIs read).
 */

export interface DashboardAnalyticsRow {
  actualPiles: number;
  actualPileMeters: number;
  plannedPiles: number;
  plannedPileMeters: number;
  actualDrillingCount: number;
  actualDrilling: number;
  plannedDrillingCount: number;
  plannedDrilling: number;
  totalDowntime: number | null;
  totalReports: number;
}

export interface DashboardFleetTotals {
  activeToday: number;
  expected: number;
  totalEquipment: number;
  crewsOnShiftToday: number;
}

export interface DashboardMaintFlag {
  repair?: boolean;
  overdue?: boolean;
}

/**
 * Моточасы установки — второй источник признака «просрочено», рядом с нарядами.
 *
 * ЗАЧЕМ ОТДЕЛЬНО. Наряд считается просроченным по `scheduledAt`, а он у
 * моточасовых регламентов пуст: `evaluatePlanDue` возвращает `dueDate` только
 * для триггера CALENDAR, планировщик пишет `scheduledAt: dueDate ?? null`, и на
 * парке с одними HOURS-регламентами дата не появляется никогда. Перепробег при
 * этом реален — воркер шлёт по нему оповещение, а плитка показывала ноль.
 */
export interface DashboardRigHours {
  id: string;
  engineHoursTotal: number | null;
  nextMaintenanceAtHours: number | null;
}

/** Наработка перевалила за предел, назначенный регламентом. */
const hoursOverrun = (rig: DashboardRigHours): boolean =>
  rig.engineHoursTotal != null
  && rig.nextMaintenanceAtHours != null
  && rig.engineHoursTotal > rig.nextMaintenanceAtHours;

export interface DashboardKpis {
  shiftsDone: number;
  reportsExpected: number;
  reports: number;
  actualPiles: number;
  actualPileMeters: number;
  plannedPiles: number;
  plannedPileMeters: number;
  actualDrillingCount: number;
  actualDrilling: number;
  plannedDrillingCount: number;
  plannedDrilling: number;
  downtime: number;
  sitesActive: number;
  sitesTotal: number;
  rigsWorking: number;
  rigsTotal: number;
  toRisk: number;
  crews: number;
}

const sumBy = <T>(rows: T[], pick: (row: T) => number): number =>
  rows.reduce((sum, row) => sum + pick(row), 0);

export function computeDashboardKpis(
  analytics: DashboardAnalyticsRow[],
  fleetTotals: DashboardFleetTotals | null,
  maintByRig: Map<string, DashboardMaintFlag>,
  rigs: DashboardRigHours[],
): DashboardKpis {
  const activeToday = fleetTotals?.activeToday ?? 0;
  const expected = fleetTotals?.expected ?? 0;
  // Считаем установки, а не поводы: машина в ремонте и с перепробегом
  // одновременно — это одна установка в риске, а не две.
  const atRisk = new Set<string>();
  for (const [equipmentId, flag] of maintByRig) {
    if (flag.repair || flag.overdue) atRisk.add(equipmentId);
  }
  for (const rig of rigs) {
    if (hoursOverrun(rig)) atRisk.add(rig.id);
  }
  const toRisk = atRisk.size;
  return {
    shiftsDone: activeToday,
    reportsExpected: activeToday + expected,
    reports: sumBy(analytics, (a) => a.totalReports),
    actualPiles: sumBy(analytics, (a) => a.actualPiles),
    actualPileMeters: sumBy(analytics, (a) => a.actualPileMeters),
    plannedPiles: sumBy(analytics, (a) => a.plannedPiles),
    plannedPileMeters: sumBy(analytics, (a) => a.plannedPileMeters),
    actualDrillingCount: sumBy(analytics, (a) => a.actualDrillingCount),
    actualDrilling: sumBy(analytics, (a) => a.actualDrilling),
    plannedDrillingCount: sumBy(analytics, (a) => a.plannedDrillingCount),
    plannedDrilling: sumBy(analytics, (a) => a.plannedDrilling),
    downtime: sumBy(analytics, (a) => a.totalDowntime || 0),
    sitesActive: analytics.filter((a) => a.totalReports > 0).length,
    sitesTotal: analytics.length,
    rigsWorking: activeToday,
    rigsTotal: fleetTotals?.totalEquipment ?? 0,
    toRisk,
    crews: fleetTotals?.crewsOnShiftToday ?? 0,
  };
}
