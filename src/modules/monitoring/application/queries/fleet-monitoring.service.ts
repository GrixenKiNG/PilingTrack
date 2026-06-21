/**
 * Fleet monitoring — single read-only snapshot of the equipment park.
 *
 * One call returns everything `/monitoring` needs: equipment cards with
 * status + today's totals + last activity. Designed to be cheap on a
 * fleet of 5-30 machines and 7 days of reports (~< 200 rows total).
 *
 * Status rules (calendar-based, NOT clock-based — see below):
 *   - active   = at least one report with date = today
 *   - expected = no report today, but one within the previous 2 days
 *   - idle     = nothing for 3+ days
 *
 * Why calendar-based, not "shift-due-by-X":
 *   The project supports both day and night shifts and lets each
 *   operator file their own report on their own clock. A schedule-
 *   based rule ("should have reported by 12:00") generates false
 *   alerts the moment someone works a night shift. Presence-based
 *   rules degrade gracefully across shifts and weekends.
 */

import { db } from '@/lib/db';
import { pileLengthMeters } from '@/lib/pile-length';
import type { EquipmentKind } from '@/generated/postgres-client';

const RECENT_WINDOW_DAYS = 7;
const EXPECTED_WINDOW_DAYS = 2;
const FLEET_TZ = 'Europe/Moscow'; // single-tenant prod runs on MSK time

export type EquipmentStatus = 'active' | 'expected' | 'idle';
export type ReportStatus = 'has_report' | 'expected' | 'missing';
export type EquipmentOperationalStatus = 'working' | 'repair' | 'idle';

export interface FleetCard {
  id: string;
  name: string;
  model: string;
  manufactureYear: number | null;
  // Inventory fields — consumed by the Установки fleet-center management view.
  // Telemetry will later override engineHoursTotal; for now it's manual entry.
  kind: EquipmentKind;
  inventoryNumber: string | null;
  serialNumber: string | null;
  engineHoursTotal: number | null;
  nextMaintenanceDate: string | null;
  nextMaintenanceAtHours: number | null;
  assignedSiteName: string | null;
  assignedOperatorName: string | null;
  assignedCrewName: string | null;
  /** Legacy report-presence status. Kept for /monitoring and existing cards. */
  status: EquipmentStatus;
  reportStatus: ReportStatus;
  equipmentStatus: EquipmentOperationalStatus;
  todaysReports: number;
  todayTotals: {
    piles: number;
    pileMeters: number;
    drillingCount: number;
    drillingMeters: number;
    downtimeHours: number;
  } | null;
  downtimeReason: string | null;
  latestReport: {
    date: string;
    siteName: string | null;
    operatorName: string | null;
    shiftType: string;
    updatedAt: string;
  } | null;
}

export interface FleetSnapshot {
  asOf: string;
  today: string;
  totals: {
    totalEquipment: number;
    activeToday: number;
    expected: number;
    idle: number;
    pilesToday: number;
    drillingToday: number;
    downtimeHoursToday: number;
    /** Distinct crews that filed a shift report today ("бригады на смене"). */
    crewsOnShiftToday: number;
    /** Distinct operators that filed a shift report today ("операторы на смене"). */
    operatorsOnShiftToday: number;
  };
  equipment: FleetCard[];
}

export interface FleetSnapshotOptions {
  /** Tenant scope; required for multi-tenant safety. */
  tenantId: string;
  /** When set, restrict to equipment crew-assigned to this operator. */
  operatorUserId?: string | null;
}

// --------------------------------------------------------------------------

export async function getFleetSnapshot(opts: FleetSnapshotOptions): Promise<FleetSnapshot> {
  // Fail closed on a missing tenant. The type and route already guard this;
  // this throws loudly rather than letting a falsy tenant silently return an
  // empty fleet (symmetric with getEquipmentAnalytics).
  if (!opts.tenantId) {
    throw new Error('getFleetSnapshot: tenantId is required');
  }

  const now = new Date();
  const today = ymd(now);
  const recentCutoff = ymd(daysAgo(now, RECENT_WINDOW_DAYS));
  const expectedCutoff = ymd(daysAgo(now, EXPECTED_WINDOW_DAYS));

  // Equipment in scope: tenant-isolated, optionally operator-scoped via Crew.
  const equipment = await db.equipment.findMany({
    where: {
      isActive: true,
      tenantId: opts.tenantId,
      ...(opts.operatorUserId
        ? {
            // Operator sees only what they're assigned to via an active crew.
            // Schema: Crew has operatorId + equipmentId + isActive.
            crews: {
              some: { operatorId: opts.operatorUserId, isActive: true },
            },
          }
        : {}),
    },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      model: true,
      manufactureYear: true,
      kind: true,
      inventoryNumber: true,
      serialNumber: true,
      engineHoursTotal: true,
      nextMaintenanceDate: true,
      nextMaintenanceAtHours: true,
      crews: {
        where: { isActive: true },
        take: 1,
        orderBy: { updatedAt: 'desc' },
        select: {
          name: true,
          operator: { select: { name: true } },
          site: { select: { name: true } },
        },
      },
      maintenanceRecords: {
        where: {
          status: 'IN_PROGRESS',
          type: { in: ['REPAIR', 'FAULT'] },
        },
        take: 1,
        orderBy: { updatedAt: 'desc' },
        select: { id: true },
      },
    },
  });

  if (equipment.length === 0) {
    return {
      asOf: now.toISOString(),
      today,
      totals: { totalEquipment: 0, activeToday: 0, expected: 0, idle: 0, pilesToday: 0, drillingToday: 0, downtimeHoursToday: 0, crewsOnShiftToday: 0, operatorsOnShiftToday: 0 },
      equipment: [],
    };
  }

  const equipmentIds = equipment.map((e) => e.id);

  // One query pulls every report in the recent window — small dataset.
  // Date is stored as 'YYYY-MM-DD' string in the schema, so plain string
  // gte comparison works (lexicographic == chronological).
  const reports = await db.report.findMany({
    where: {
      equipmentId: { in: equipmentIds },
      date: { gte: recentCutoff },
      tenantId: opts.tenantId,
    },
    orderBy: { date: 'desc' },
    select: {
      id: true,
      reportId: true,
      equipmentId: true,
      crewId: true,
      userId: true,
      date: true,
      shiftType: true,
      updatedAt: true,
      piles: { select: { count: true, pileGrade: { select: { name: true, lengthMm: true } } } },
      drillings: { select: { count: true, meters: true } },
      downtimes: {
        select: {
          duration: true,
          comment: true,
          reason: { select: { name: true } },
        },
      },
      user: { select: { name: true } },
      site: { select: { name: true } },
    },
  });

  // Analytics rows are linked by Report.reportId (string), not Report.id.
  // Keep them in a single map lookup.
  const reportIds = reports.map((r) => r.reportId);
  const analyticsRows = reportIds.length
    ? await db.reportAnalytics.findMany({
        where: { reportId: { in: reportIds } },
        select: { reportId: true, totalPiles: true, totalDrilling: true, totalDowntime: true },
      })
    : [];
  const analyticsByReport = new Map(analyticsRows.map((a) => [a.reportId, a]));

  // Group reports per equipment (already sorted by date desc).
  const reportsByEquipment = new Map<string, typeof reports>();
  for (const r of reports) {
    if (!r.equipmentId) continue;
    let arr = reportsByEquipment.get(r.equipmentId);
    if (!arr) {
      arr = [];
      reportsByEquipment.set(r.equipmentId, arr);
    }
    arr.push(r);
  }

  // Build cards.
  const cards: FleetCard[] = equipment.map((eq) => {
    const eqReports = reportsByEquipment.get(eq.id) ?? [];
    const todays = eqReports.filter((r) => r.date === today);
    const hasExpected = eqReports.some((r) => r.date >= expectedCutoff);

    const status: EquipmentStatus =
      todays.length > 0 ? 'active' : hasExpected ? 'expected' : 'idle';
    const reportStatus: ReportStatus =
      status === 'active' ? 'has_report' : status === 'expected' ? 'expected' : 'missing';

    let todayTotals: FleetCard['todayTotals'] = null;
    let downtimeReason: string | null = null;
    if (todays.length > 0) {
      todayTotals = { piles: 0, pileMeters: 0, drillingCount: 0, drillingMeters: 0, downtimeHours: 0 };
      const downtimeByReason = new Map<string, { duration: number; comment: string | null }>();
      for (const r of todays) {
        const a = analyticsByReport.get(r.reportId);
        if (!a) continue;
        todayTotals.piles += a.totalPiles;
        todayTotals.pileMeters += r.piles.reduce(
          (sum, pile) => sum + pile.count * pileLengthMeters({ gradeLengthMm: pile.pileGrade?.lengthMm }),
          0,
        );
        todayTotals.drillingCount += r.drillings.reduce((sum, drilling) => sum + (drilling.count || 1), 0);
        todayTotals.drillingMeters += a.totalDrilling;
        todayTotals.downtimeHours += a.totalDowntime;
        for (const downtime of r.downtimes ?? []) {
          const reasonName = downtime.reason?.name ?? 'Причина не указана';
          const current = downtimeByReason.get(reasonName) ?? { duration: 0, comment: null };
          current.duration += downtime.duration ?? 0;
          current.comment = current.comment || downtime.comment || null;
          downtimeByReason.set(reasonName, current);
        }
      }
      const topDowntime = [...downtimeByReason.entries()].sort((a, b) => b[1].duration - a[1].duration)[0];
      if (topDowntime) {
        downtimeReason = topDowntime[1].comment
          ? `${topDowntime[0]}: ${topDowntime[1].comment}`
          : topDowntime[0];
      }
    }

    const latest = eqReports[0] ?? null;
    const activeCrew = eq.crews[0] ?? null;
    const hasActiveRepair = (eq.maintenanceRecords ?? []).length > 0;
    const equipmentStatus: EquipmentOperationalStatus = hasActiveRepair
      ? 'repair'
      : status === 'active'
        ? 'working'
        : 'idle';
    return {
      id: eq.id,
      name: eq.name,
      model: eq.model,
      manufactureYear: eq.manufactureYear,
      kind: eq.kind,
      inventoryNumber: eq.inventoryNumber,
      serialNumber: eq.serialNumber,
      engineHoursTotal: eq.engineHoursTotal,
      nextMaintenanceDate: eq.nextMaintenanceDate?.toISOString() ?? null,
      nextMaintenanceAtHours: eq.nextMaintenanceAtHours,
      assignedSiteName: activeCrew?.site?.name ?? null,
      assignedOperatorName: activeCrew?.operator?.name ?? null,
      assignedCrewName: activeCrew?.name ?? null,
      status,
      reportStatus,
      equipmentStatus,
      todaysReports: todays.length,
      todayTotals,
      downtimeReason,
      latestReport: latest
        ? {
            date: latest.date,
            siteName: latest.site?.name ?? null,
            operatorName: latest.user?.name ?? null,
            shiftType: latest.shiftType,
            updatedAt: latest.updatedAt.toISOString(),
          }
        : null,
    };
  });

  // Distinct crews with a report dated today — "бригады на смене".
  const crewsOnShiftToday = new Set(
    reports.filter((r) => r.date === today && r.crewId).map((r) => r.crewId),
  ).size;

  // Distinct operators with a report dated today — "операторы на смене".
  const operatorsOnShiftToday = new Set(
    reports.filter((r) => r.date === today && r.userId).map((r) => r.userId),
  ).size;

  const totals = {
    totalEquipment: cards.length,
    activeToday: cards.filter((c) => c.status === 'active').length,
    expected: cards.filter((c) => c.status === 'expected').length,
    idle: cards.filter((c) => c.status === 'idle').length,
    pilesToday: cards.reduce((s, c) => s + (c.todayTotals?.piles ?? 0), 0),
    drillingToday: cards.reduce((s, c) => s + (c.todayTotals?.drillingMeters ?? 0), 0),
    downtimeHoursToday: cards.reduce((s, c) => s + (c.todayTotals?.downtimeHours ?? 0), 0),
    crewsOnShiftToday,
    operatorsOnShiftToday,
  };

  return {
    asOf: now.toISOString(),
    today,
    totals,
    equipment: cards,
  };
}

// --------------------------------------------------------------------------

/** Format a Date as 'YYYY-MM-DD' in the fleet's tenant timezone. */
function ymd(d: Date): string {
  // 'sv-SE' locale gives 'YYYY-MM-DD'. Using the fleet TZ keeps "today"
  // aligned with the operator's calendar, not UTC.
  return d.toLocaleDateString('sv-SE', { timeZone: FLEET_TZ });
}

function daysAgo(d: Date, n: number): Date {
  return new Date(d.getTime() - n * 86_400_000);
}
