import { db } from '@/lib/db';

interface SiteAnalyticsRow {
  siteId: string;
  siteName: string;
  plannedPiles: number;
  plannedPileMeters: number;
  plannedDrillingCount: number;
  actualPiles: number;
  actualPileMeters: number;
  actualDrillingCount: number;
  plannedDrilling: number;
  actualDrilling: number;
  totalDowntime: number;
  totalReports: number;
}

export interface SiteAnalyticsOptions {
  /** Tenant scope — required for multi-tenant safety (fail closed). */
  tenantId: string;
  /** Inclusive 'YYYY-MM-DD'. When both bounds set, actuals are limited to the period. */
  dateFrom?: string;
  dateTo?: string;
  /** Restrict to a single site. */
  siteId?: string;
}

/**
 * Aggregates per-site progress in a single SQL round-trip.
 *
 * The previous implementation used Prisma `findMany` with deeply nested
 * `include` (reports → piles/drillings/downtimes) and summed every row in
 * Node — which materialized thousands of child rows just to compute integer
 * sums, and was a real OOM risk on large tenants.
 *
 * Each child sum is computed in its own subquery (joined LEFT) to avoid the
 * Cartesian explosion that a flat multi-LEFT-JOIN would produce.
 *
 * Plans (`plannedPiles`/`plannedDrilling`) are the whole-site targets and are
 * never sliced by the period — only the *actuals* (work done) are. When no
 * period is given the actuals cover all time (previous behaviour preserved).
 */
export async function getSiteAnalytics(opts: SiteAnalyticsOptions) {
  // Fail closed on a missing tenant — never return every tenant's rows.
  if (!opts.tenantId) {
    throw new Error('getSiteAnalytics: tenantId is required');
  }

  const { tenantId } = opts;
  // Date is stored as 'YYYY-MM-DD' string, so plain string range comparison
  // works (lexicographic == chronological), same as the fleet service.
  //
  // We interpolate only *scalar* params (never nested Prisma.sql fragments):
  // nested fragments mis-number positional params under Turbopack — the $4 bug
  // that broke /api/reports/pdf in 2026-04 (see raw-queries.test.ts). When no
  // period is given we use wide sentinel bounds so the actuals cover all time,
  // and siteId is a nullable scalar matched with IS NULL OR (a UI filter, not a
  // tenant boundary — tenant isolation stays strict equality below).
  const dateFrom = opts.dateFrom ?? '0000-01-01';
  const dateTo = opts.dateTo ?? '9999-12-31';
  const siteId = opts.siteId ?? null;

  const rows = await db.$queryRaw<SiteAnalyticsRow[]>`
    SELECT
      s.id                                  AS "siteId",
      s.name                                AS "siteName",
      s."plannedPiles"                      AS "plannedPiles",
      s."plannedDrilling"                   AS "plannedDrilling",
      COALESCE(pp.total_pile_meters, 0)::float AS "plannedPileMeters",
      COALESCE(dp.total_drilling_count, 0)::int AS "plannedDrillingCount",
      COALESCE(p.total_piles, 0)::int       AS "actualPiles",
      COALESCE(p.total_pile_meters, 0)::float AS "actualPileMeters",
      COALESCE(d.total_meters, 0)::float    AS "actualDrilling",
      COALESCE(d.total_count, 0)::int       AS "actualDrillingCount",
      COALESCE(dt.total_duration, 0)::float AS "totalDowntime",
      COALESCE(rc.report_count, 0)::int     AS "totalReports"
    FROM "Site" s
    LEFT JOIN (
      SELECT
        spp."siteId",
        SUM(
          spp.count * COALESCE(
            NULLIF(spp."metersPerUnit", 0),
            substring(pg.name from '[0-9]{3}')::float / 10,
            0
          )
        )::float AS total_pile_meters
      FROM "SitePilePlan" spp
      JOIN "PileGrade" pg ON pg.id = spp."pileGradeId"
      GROUP BY spp."siteId"
    ) pp ON pp."siteId" = s.id
    LEFT JOIN (
      SELECT sdp."siteId", SUM(sdp.count)::int AS total_drilling_count
      FROM "SiteDrillingPlan" sdp
      GROUP BY sdp."siteId"
    ) dp ON dp."siteId" = s.id
    LEFT JOIN (
      SELECT r."siteId", COUNT(*)::int AS report_count
      FROM "Report" r
      WHERE r.date >= ${dateFrom} AND r.date <= ${dateTo}
      GROUP BY r."siteId"
    ) rc ON rc."siteId" = s.id
    LEFT JOIN (
      SELECT
        r."siteId",
        SUM(pw.count)::int AS total_piles,
        SUM(pw.count * (COALESCE(pg."lengthMm", 0)::float / 1000))::float AS total_pile_meters
      FROM "Report" r
      JOIN "PileWork" pw ON pw."reportId" = r.id
      JOIN "PileGrade" pg ON pg.id = pw."pileGradeId"
      WHERE r.date >= ${dateFrom} AND r.date <= ${dateTo}
      GROUP BY r."siteId"
    ) p ON p."siteId" = s.id
    LEFT JOIN (
      SELECT
        r."siteId",
        SUM(ld.meters)::float AS total_meters,
        SUM(ld.count)::int AS total_count
      FROM "Report" r
      JOIN "LeaderDrilling" ld ON ld."reportId" = r.id
      WHERE r.date >= ${dateFrom} AND r.date <= ${dateTo}
      GROUP BY r."siteId"
    ) d ON d."siteId" = s.id
    LEFT JOIN (
      SELECT r."siteId", SUM(rd.duration)::float AS total_duration
      FROM "Report" r
      JOIN "ReportDowntime" rd ON rd."reportId" = r.id
      WHERE r.date >= ${dateFrom} AND r.date <= ${dateTo}
      GROUP BY r."siteId"
    ) dt ON dt."siteId" = s.id
    WHERE s."isActive" = true
      AND s."tenantId" = ${tenantId}
      AND (${siteId}::text IS NULL OR s.id = ${siteId})
    ORDER BY s.name ASC
  `;

  return rows.map((row) => ({
    siteId: row.siteId,
    siteName: row.siteName,
    plannedPiles: row.plannedPiles,
    actualPiles: row.actualPiles,
    plannedPileMeters: parseFloat(row.plannedPileMeters.toFixed(1)),
    actualPileMeters: parseFloat(row.actualPileMeters.toFixed(1)),
    plannedDrillingCount: row.plannedDrillingCount,
    actualDrillingCount: row.actualDrillingCount,
    plannedDrilling: row.plannedDrilling,
    actualDrilling: parseFloat(row.actualDrilling.toFixed(1)),
    pileProgress:
      row.plannedPiles > 0 ? Math.min(100, (row.actualPiles / row.plannedPiles) * 100) : 0,
    drillingProgress:
      row.plannedDrilling > 0
        ? Math.min(100, (row.actualDrilling / row.plannedDrilling) * 100)
        : 0,
    totalReports: row.totalReports,
    totalDowntime: parseFloat(row.totalDowntime.toFixed(1)),
  }));
}
