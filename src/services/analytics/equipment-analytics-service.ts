import { db } from '@/lib/db';

/**
 * Fleet analytics aggregated per equipment for a date range. Mirrors the
 * site-analytics approach (one SQL round-trip, child sums in separate LEFT
 * JOIN subqueries to avoid a Cartesian explosion) but groups by equipmentId
 * and is bounded by [dateFrom, dateTo]. A CTE narrows the report set once so
 * the period/tenant/site filters are written a single time.
 *
 * Fuel is the only metric not derivable from reports — it comes from the
 * telematics `fuel_total` cumulative counter (period usage = max − min per
 * rig). With no box connected it's simply 0.
 */

interface EquipmentRow {
  equipmentId: string;
  name: string;
  model: string | null;
  kind: string;
  reportCount: number;
  activeDays: number;
  piles: number;
  pileMeters: number;
  drillingCount: number;
  drillingMeters: number;
  downtimeMinutes: number;
  engineHoursTotal: number | null;
  nextMaintenanceAtHours: number | null;
  nextMaintenanceDate: Date | null;
}

interface ParetoRow {
  reasonId: string;
  reasonName: string;
  minutes: number;
}

export interface EquipmentAnalyticsParams {
  dateFrom: string;
  dateTo: string;
  siteId?: string | null;
  tenantId?: string | null;
}

function daysInPeriod(dateFrom: string, dateTo: string): number {
  const from = new Date(`${dateFrom}T00:00:00`);
  const to = new Date(`${dateTo}T00:00:00`);
  const diff = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  return diff > 0 ? diff : 1;
}

function maintenanceDue(row: EquipmentRow): boolean {
  // Due if the service date is within 14 days / past, or engine hours are
  // within 50h of the next-service threshold.
  if (row.nextMaintenanceDate) {
    const days = (new Date(row.nextMaintenanceDate).getTime() - Date.now()) / 86_400_000;
    if (days <= 14) return true;
  }
  if (row.engineHoursTotal != null && row.nextMaintenanceAtHours != null) {
    if (row.engineHoursTotal >= row.nextMaintenanceAtHours - 50) return true;
  }
  return false;
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

  const rows = await db.$queryRaw<EquipmentRow[]>`
    WITH rep AS (
      SELECT r.id, r."equipmentId", r.date, r."siteId"
      FROM "Report" r
      WHERE r.date >= ${dateFrom}
        AND r.date <= ${dateTo}
        AND r."equipmentId" IS NOT NULL
        AND r."tenantId" = ${tenantId}
        AND (${siteId}::text IS NULL OR r."siteId" = ${siteId})
    )
    SELECT
      e.id                                   AS "equipmentId",
      e.name                                 AS "name",
      e.model                                AS "model",
      e.kind::text                           AS "kind",
      e."engineHoursTotal"                   AS "engineHoursTotal",
      e."nextMaintenanceAtHours"             AS "nextMaintenanceAtHours",
      e."nextMaintenanceDate"                AS "nextMaintenanceDate",
      COALESCE(rc.report_count, 0)::int      AS "reportCount",
      COALESCE(rc.active_days, 0)::int       AS "activeDays",
      COALESCE(p.total_piles, 0)::int        AS "piles",
      COALESCE(p.total_pile_meters, 0)::float AS "pileMeters",
      COALESCE(d.total_count, 0)::int        AS "drillingCount",
      COALESCE(d.total_meters, 0)::float     AS "drillingMeters",
      COALESCE(dt.total_duration, 0)::float  AS "downtimeMinutes"
    FROM "Equipment" e
    LEFT JOIN (
      SELECT rep."equipmentId", COUNT(*)::int AS report_count, COUNT(DISTINCT rep.date)::int AS active_days
      FROM rep GROUP BY rep."equipmentId"
    ) rc ON rc."equipmentId" = e.id
    LEFT JOIN (
      SELECT
        rep."equipmentId",
        SUM(pw.count)::int AS total_piles,
        SUM(
          pw.count * COALESCE(
            NULLIF(spp."metersPerUnit", 0),
            substring(pg.name from '[0-9]{3}')::float / 10,
            0
          )
        )::float AS total_pile_meters
      FROM rep
      JOIN "PileWork" pw ON pw."reportId" = rep.id
      JOIN "PileGrade" pg ON pg.id = pw."pileGradeId"
      LEFT JOIN "SitePilePlan" spp
        ON spp."siteId" = rep."siteId" AND spp."pileGradeId" = pw."pileGradeId"
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
        AND r."tenantId" = ${tenantId}
        AND (${siteId}::text IS NULL OR r."siteId" = ${siteId})
    )
    SELECT rd."reasonId" AS "reasonId", dr.name AS "reasonName", SUM(rd.duration)::float AS "minutes"
    FROM rep
    JOIN "ReportDowntime" rd ON rd."reportId" = rep.id
    JOIN "DowntimeReason" dr ON dr.id = rd."reasonId"
    GROUP BY rd."reasonId", dr.name
    ORDER BY "minutes" DESC
  `;

  // Fuel from telematics cumulative counter (max − min per rig over the range).
  const fromTs = new Date(`${dateFrom}T00:00:00`);
  const toTs = new Date(`${dateTo}T23:59:59.999`);
  const fuelGrouped = await db.telemetryRecord.groupBy({
    by: ['equipmentId'],
    where: {
      type: 'fuel_total',
      timestamp: { gte: fromTs, lte: toTs },
      ...(siteId ? { siteId } : {}),
    },
    _min: { value: true },
    _max: { value: true },
  });
  const fuelByEquipment = new Map<string, number>();
  for (const g of fuelGrouped) {
    const used = (g._max.value ?? 0) - (g._min.value ?? 0);
    if (used > 0) fuelByEquipment.set(g.equipmentId, used);
  }

  const equipment = rows.map((row) => {
    const due = maintenanceDue(row);
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
      downtimeMinutes: round1(row.downtimeMinutes),
      fuelLiters: round1(fuelByEquipment.get(row.equipmentId) ?? 0),
      engineHoursTotal: row.engineHoursTotal,
      nextMaintenanceAtHours: row.nextMaintenanceAtHours,
      nextMaintenanceDate: row.nextMaintenanceDate ? row.nextMaintenanceDate.toISOString() : null,
      maintenanceDue: due,
    };
  });

  const periodDays = daysInPeriod(dateFrom, dateTo);

  const fleet = {
    totalEquipment: equipment.length,
    activeCount: equipment.filter((e) => e.reportCount > 0).length,
    piles: equipment.reduce((s, e) => s + e.piles, 0),
    pileMeters: round1(equipment.reduce((s, e) => s + e.pileMeters, 0)),
    drillingCount: equipment.reduce((s, e) => s + e.drillingCount, 0),
    drillingMeters: round1(equipment.reduce((s, e) => s + e.drillingMeters, 0)),
    downtimeMinutes: round1(equipment.reduce((s, e) => s + e.downtimeMinutes, 0)),
    fuelLiters: round1(equipment.reduce((s, e) => s + e.fuelLiters, 0)),
    maintenanceDueCount: equipment.filter((e) => e.maintenanceDue).length,
  };

  const totalDowntime = pareto.reduce((s, r) => s + r.minutes, 0);
  const downtimePareto = pareto.map((r) => ({
    reasonId: r.reasonId,
    reasonName: r.reasonName,
    minutes: round1(r.minutes),
    pct: totalDowntime > 0 ? Math.round((r.minutes / totalDowntime) * 100) : 0,
  }));

  return { dateFrom, dateTo, periodDays, fleet, equipment, downtimePareto };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
