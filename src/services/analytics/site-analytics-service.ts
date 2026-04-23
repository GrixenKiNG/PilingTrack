import { db } from '@/lib/db';

interface SiteAnalyticsRow {
  siteId: string;
  siteName: string;
  plannedPiles: number;
  plannedPileMeters: number;
  plannedDrilling: number;
  plannedDrillingCount: number;
  actualPiles: number;
  actualPileMeters: number;
  actualDrilling: number;
  actualDrillingCount: number;
  totalDowntime: number;
  totalReports: number;
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
 */
export async function getSiteAnalytics() {
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
      GROUP BY r."siteId"
    ) rc ON rc."siteId" = s.id
    LEFT JOIN (
      SELECT
        r."siteId",
        SUM(pw.count)::int AS total_piles,
        SUM(
          pw.count * COALESCE(
            NULLIF(spp."metersPerUnit", 0),
            substring(pg.name from '[0-9]{3}')::float / 10,
            0
          )
        )::float AS total_pile_meters
      FROM "Report" r
      JOIN "PileWork" pw ON pw."reportId" = r.id
      JOIN "PileGrade" pg ON pg.id = pw."pileGradeId"
      LEFT JOIN "SitePilePlan" spp
        ON spp."siteId" = r."siteId"
       AND spp."pileGradeId" = pw."pileGradeId"
      GROUP BY r."siteId"
    ) p ON p."siteId" = s.id
    LEFT JOIN (
      SELECT
        r."siteId",
        SUM(ld.meters)::float AS total_meters,
        SUM(ld.count)::int AS total_count
      FROM "Report" r
      JOIN "LeaderDrilling" ld ON ld."reportId" = r.id
      GROUP BY r."siteId"
    ) d ON d."siteId" = s.id
    LEFT JOIN (
      SELECT r."siteId", SUM(rd.duration)::float AS total_duration
      FROM "Report" r
      JOIN "ReportDowntime" rd ON rd."reportId" = r.id
      GROUP BY r."siteId"
    ) dt ON dt."siteId" = s.id
    WHERE s."isActive" = true
    ORDER BY s.name ASC
  `;

  return rows.map((row) => ({
    siteId: row.siteId,
    siteName: row.siteName,
    plannedPiles: row.plannedPiles,
    plannedPileMeters: parseFloat(row.plannedPileMeters.toFixed(1)),
    actualPiles: row.actualPiles,
    actualPileMeters: parseFloat(row.actualPileMeters.toFixed(1)),
    plannedDrilling: row.plannedDrilling,
    plannedDrillingCount: row.plannedDrillingCount,
    actualDrilling: parseFloat(row.actualDrilling.toFixed(1)),
    actualDrillingCount: row.actualDrillingCount,
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
