-- Backfill missing ReportAnalytics rows.
--
-- ReportAnalytics is built in real time by handleReportForAnalytics in
-- services/reports/event-handlers.ts. If that handler ever doesn't run
-- (registration race on cold start, DB outage, deploy bug), the rows
-- are missing and the monitoring dashboard shows empty data for those
-- reports.
--
-- This script:
--   1. Counts how many Report rows in the last :days days have no
--      matching ReportAnalytics row (joined by uuid Report.reportId).
--   2. INSERTs the missing rows, computing totalPiles / totalDrilling /
--      totalDowntime from the child tables (PileWork, LeaderDrilling,
--      ReportDowntime — all keyed by Report.id cuid, NOT reportId uuid).
--   3. Re-counts to confirm zero missing.
--   4. Lists what was just written.
--
-- Idempotent: ON CONFLICT ("reportId") DO NOTHING, safe to re-run.
-- Use ":days" parameter to control the window (default 7 if not set).
--
-- See:
--   src/services/reports/event-handlers.ts:handleReportForAnalytics
--     — the realtime path. Mirror this logic if you change shape.
--   src/modules/reports/application/projections/rebuild.ts
--     — the canonical Prisma-based rebuilder. Use this script ONLY for
--       quick incident response; for full rebuild use:
--       POST /api/admin/projections/rebuild?name=report-analytics

\set ON_ERROR_STOP on
\set days '7'
\set days `echo "${BACKFILL_DAYS:-7}"`

\echo == Reports in last :days day(s) with no analytics row ==
SELECT count(*) AS missing
FROM "Report" r
WHERE r."createdAt" > now() - (:'days' || ' days')::interval
  AND NOT EXISTS (
    SELECT 1 FROM "ReportAnalytics" ra
    WHERE ra."reportId" = r."reportId"
  );

\echo == Inserting missing rows ==
INSERT INTO "ReportAnalytics" (
  id, "reportId", "siteId", "userId", "tenantId", status,
  "totalPiles", "totalDrilling", "totalDowntime",
  "lastEventAt", "createdAt"
)
SELECT
  'ra_' || r."reportId",
  r."reportId",
  r."siteId",
  r."userId",
  r."tenantId",
  COALESCE(r.status, 'draft'),
  COALESCE((SELECT SUM(count)::int FROM "PileWork"       WHERE "reportId" = r.id), 0),
  COALESCE((SELECT SUM(meters)     FROM "LeaderDrilling" WHERE "reportId" = r.id), 0),
  COALESCE((SELECT SUM(duration)   FROM "ReportDowntime" WHERE "reportId" = r.id), 0),
  r."updatedAt",
  now()
FROM "Report" r
WHERE r."createdAt" > now() - (:'days' || ' days')::interval
  AND NOT EXISTS (
    SELECT 1 FROM "ReportAnalytics" ra
    WHERE ra."reportId" = r."reportId"
  )
ON CONFLICT ("reportId") DO NOTHING;

\echo == Still missing (should be 0) ==
SELECT count(*) AS still_missing
FROM "Report" r
WHERE r."createdAt" > now() - (:'days' || ' days')::interval
  AND NOT EXISTS (
    SELECT 1 FROM "ReportAnalytics" ra
    WHERE ra."reportId" = r."reportId"
  );

\echo == Analytics rows for the window ==
SELECT ra."reportId", ra.status,
       ra."totalPiles", ra."totalDrilling", ra."totalDowntime",
       ra."lastEventAt"
FROM "ReportAnalytics" ra
JOIN "Report" r ON r."reportId" = ra."reportId"
WHERE r."createdAt" > now() - (:'days' || ' days')::interval
ORDER BY ra."lastEventAt" DESC;
