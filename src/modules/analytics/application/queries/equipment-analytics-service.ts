import { readFuelConsumptions } from '@/modules/equipment';
import { SUBMITTED_REPORT_STATUS } from '@/lib/report-status';
import { db } from '@/lib/db';
import { checkMaintenanceDue } from '@/lib/maintenance-due';
import { zonedDayStartUtc } from '@/lib/timezone';

/**
 * Fleet analytics aggregated per equipment for a date range. Mirrors the
 * site-analytics approach (one SQL round-trip, child sums in separate LEFT
 * JOIN subqueries to avoid a Cartesian explosion) but groups by equipmentId
 * and is bounded by [dateFrom, dateTo]. A CTE narrows the report set once so
 * the period/tenant/site filters are written a single time.
 *
 * Fuel uses the shared equipment contract: valid cumulative telemetry first,
 * then the manual tank balance. A reset or insufficient readings never become zero.
 */

interface EquipmentRow {
  equipmentId: string;
  name: string;
  model: string | null;
  kind: string;
  fuelTankLiters: number | null;
  reportCount: number;
  activeDays: number;
  piles: number;
  pileMeters: number;
  drillingCount: number;
  drillingMeters: number;
  downtimeHours: number;
  engineHoursTotal: number | null;
  nextMaintenanceAtHours: number | null;
  nextMaintenanceDate: Date | null;
}

interface ParetoRow {
  reasonId: string;
  reasonName: string;
  hours: number;
}

export interface EquipmentAnalyticsParams {
  dateFrom: string;
  dateTo: string;
  siteId?: string | null;
  tenantId?: string | null;
  timezone?: string;
}

function daysInPeriod(dateFrom: string, dateTo: string): number {
  const from = new Date(`${dateFrom}T00:00:00`);
  const to = new Date(`${dateTo}T00:00:00`);
  const diff = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  return diff > 0 ? diff : 1;
}

export async function getEquipmentAnalytics(params: EquipmentAnalyticsParams) {
  const { dateFrom, dateTo } = params;
  const siteId = params.siteId || null;
  const tenantId = params.tenantId || null;

  // Fail closed on a missing tenant (codebase policy — see
  // resource-access-service.ts). Without this, a nullable tenant filter would
  // return every tenant's equipment instead of scoping to one. siteId stays
  // optional below; tenantId is mandatory.
  if (!tenantId) {
    throw new Error('getEquipmentAnalytics: tenantId is required');
  }
  const { timezone } = params;

  const rows = await db.$queryRaw<EquipmentRow[]>`
    WITH rep AS (
      SELECT r.id, r."equipmentId", r.date, r."siteId"
      FROM "Report" r
      WHERE r.date >= ${dateFrom}
        AND r.date <= ${dateTo}
        AND r."equipmentId" IS NOT NULL
        AND r.status = ${SUBMITTED_REPORT_STATUS}
        AND r."tenantId" = ${tenantId}
        AND (${siteId}::text IS NULL OR r."siteId" = ${siteId})
    )
    SELECT
      e.id                                   AS "equipmentId",
      e.name                                 AS "name",
      e.model                                AS "model",
      e.kind::text                           AS "kind",
      e."fuelTankLiters"                      AS "fuelTankLiters",
      e."engineHoursTotal"                   AS "engineHoursTotal",
      e."nextMaintenanceAtHours"             AS "nextMaintenanceAtHours",
      e."nextMaintenanceDate"                AS "nextMaintenanceDate",
      COALESCE(rc.report_count, 0)::int      AS "reportCount",
      COALESCE(rc.active_days, 0)::int       AS "activeDays",
      COALESCE(p.total_piles, 0)::int        AS "piles",
      COALESCE(p.total_pile_meters, 0)::float AS "pileMeters",
      COALESCE(d.total_count, 0)::int        AS "drillingCount",
      COALESCE(d.total_meters, 0)::float     AS "drillingMeters",
      COALESCE(dt.total_duration, 0)::float  AS "downtimeHours"
    FROM "Equipment" e
    LEFT JOIN (
      SELECT rep."equipmentId", COUNT(*)::int AS report_count, COUNT(DISTINCT rep.date)::int AS active_days
      FROM rep GROUP BY rep."equipmentId"
    ) rc ON rc."equipmentId" = e.id
    LEFT JOIN (
      SELECT
        rep."equipmentId",
        SUM(pw.count)::int AS total_piles,
        SUM(pw.count * (COALESCE(pg."lengthMm", 0)::float / 1000))::float AS total_pile_meters
      FROM rep
      JOIN "PileWork" pw ON pw."reportId" = rep.id
      JOIN "PileGrade" pg ON pg.id = pw."pileGradeId"
      GROUP BY rep."equipmentId"
    ) p ON p."equipmentId" = e.id
    LEFT JOIN (
      SELECT rep."equipmentId", SUM(ld.meters)::float AS total_meters, SUM(ld.count)::int AS total_count
      FROM rep JOIN "LeaderDrilling" ld ON ld."reportId" = rep.id
      GROUP BY rep."equipmentId"
    ) d ON d."equipmentId" = e.id
    LEFT JOIN (
      SELECT rep."equipmentId", SUM(rd.duration)::float AS total_duration
      FROM rep JOIN "ReportDowntime" rd ON rd."reportId" = rep.id
      GROUP BY rep."equipmentId"
    ) dt ON dt."equipmentId" = e.id
    WHERE e."isActive" = true
      AND e."tenantId" = ${tenantId}
    ORDER BY e.name ASC
  `;

  const pareto = await db.$queryRaw<ParetoRow[]>`
    WITH rep AS (
      SELECT r.id
      FROM "Report" r
      WHERE r.date >= ${dateFrom}
        AND r.date <= ${dateTo}
        AND r."equipmentId" IS NOT NULL
        AND r.status = ${SUBMITTED_REPORT_STATUS}
        AND r."tenantId" = ${tenantId}
        AND (${siteId}::text IS NULL OR r."siteId" = ${siteId})
    )
    SELECT rd."reasonId" AS "reasonId", dr.name AS "reasonName", SUM(rd.duration)::float AS "hours"
    FROM rep
    JOIN "ReportDowntime" rd ON rd."reportId" = rep.id
    JOIN "DowntimeReason" dr ON dr.id = rd."reasonId"
    GROUP BY rd."reasonId", dr.name
    ORDER BY "hours" DESC
  `;

  // Один контракт и одна граница периода для телеметрии и резервного ручного журнала.
  const fromTs = zonedDayStartUtc(dateFrom, timezone);
  const nextDay = new Date(`${dateTo}T12:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const toTs = zonedDayStartUtc(nextDay.toISOString().slice(0, 10), timezone);
  const fuelByEquipment = await readFuelConsumptions(rows, tenantId, fromTs, toTs, siteId);

  const equipment = rows.map((row) => {
    const fuelConsumption = fuelByEquipment.get(row.equipmentId)?.consumption ?? { liters: null, source: 'none' as const, quality: 'insufficient' as const };
    const fuelLiters = fuelConsumption.liters;
    const due = checkMaintenanceDue({
      nextMaintenanceDate: row.nextMaintenanceDate ? row.nextMaintenanceDate.toISOString() : null,
      nextMaintenanceAtHours: row.nextMaintenanceAtHours,
      engineHoursTotal: row.engineHoursTotal,
    });
    return {
      equipmentId: row.equipmentId,
      name: row.name,
      model: row.model,
      kind: row.kind,
      reportCount: row.reportCount,
      activeDays: row.activeDays,
      piles: row.piles,
      pileMeters: round1(row.pileMeters),
      drillingCount: row.drillingCount,
      drillingMeters: round1(row.drillingMeters),
      downtimeHours: round1(row.downtimeHours),
      fuelLiters: fuelLiters == null ? null : round1(fuelLiters),
      fuelConsumption,
      engineHoursTotal: row.engineHoursTotal,
      nextMaintenanceAtHours: row.nextMaintenanceAtHours,
      nextMaintenanceDate: row.nextMaintenanceDate ? row.nextMaintenanceDate.toISOString() : null,
      maintenanceOverdue: due.overdue,
      maintenanceSoon: due.soon,
      maintenanceDue: due.overdue || due.soon,
    };
  });

  const periodDays = daysInPeriod(dateFrom, dateTo);

  const fleet = {
    totalEquipment: equipment.length,
    activeCount: equipment.filter((e) => e.reportCount > 0).length,
    piles: equipment.reduce((s, e) => s + e.piles, 0),
    pileMeters: round1(rows.reduce((s, e) => s + e.pileMeters, 0)),
    drillingCount: equipment.reduce((s, e) => s + e.drillingCount, 0),
    drillingMeters: round1(rows.reduce((s, e) => s + e.drillingMeters, 0)),
    downtimeHours: round1(rows.reduce((s, e) => s + e.downtimeHours, 0)),
    // Частичная сумма не описывает расход всего парка.
    fuelLiters: rows.length > 0 && rows.every((row) => fuelByEquipment.get(row.equipmentId)?.consumption.liters != null)
      ? round1(rows.reduce((sum, row) => sum + (fuelByEquipment.get(row.equipmentId)?.consumption.liters ?? 0), 0))
      : null,
    fuelSources: {
      telemetry: equipment.filter((row) => row.fuelConsumption.source === 'telemetry').length,
      manual: equipment.filter((row) => row.fuelConsumption.source === 'manual').length,
      none: equipment.filter((row) => row.fuelConsumption.source === 'none').length,
    },
    maintenanceDueCount: equipment.filter((e) => e.maintenanceDue).length,
  };

  const totalDowntime = pareto.reduce((s, r) => s + r.hours, 0);
  const downtimePareto = pareto.map((r) => ({
    reasonId: r.reasonId,
    reasonName: r.reasonName,
    hours: round1(r.hours),
    pct: totalDowntime > 0 ? Math.round((r.hours / totalDowntime) * 100) : 0,
  }));

  return { dateFrom, dateTo, periodDays, fleet, equipment, downtimePareto,
    fuelScopeNote: siteId ? 'Ручной журнал не привязан к объекту: при фильтре объекта расход доступен только по телеметрии.' : null,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
