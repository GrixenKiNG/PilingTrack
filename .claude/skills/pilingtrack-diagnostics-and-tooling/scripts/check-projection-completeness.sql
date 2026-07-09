-- ============================================================
-- PilingTrack — projection completeness check (READ-ONLY)
-- ============================================================
-- Answers "is the data the dashboards show complete?" by comparing
-- source-of-truth tables against their CQRS read projections, plus
-- outbox backlog and Dead Letter Queue depth.
--
-- Every statement is a SELECT. Safe on prod.
--
-- Run locally (dev DB, container pilingtrack-postgres, db pilingtrack_test):
--   docker exec -i pilingtrack-postgres psql -U postgres -d pilingtrack_test \
--     < .claude/skills/pilingtrack-diagnostics-and-tooling/scripts/check-projection-completeness.sql
--
-- Run on prod (VPS, /opt/pilingtrack — paste file contents or scp it first):
--   docker compose exec -T postgres psql -U piling -d pilingtrack < check-projection-completeness.sql
--
-- Key facts baked into these queries (verified 2026-07-08):
--   * No @@map anywhere in schema.prisma -> physical table names ARE the
--     Prisma model names, so they must be double-quoted ("Report").
--   * ReportAnalytics.reportId and ReportStats.reportId store the BUSINESS id
--     Report."reportId" (uuid), NOT the primary key Report."id" (cuid).
--     Joining on the wrong one reports 100% missing. See the comment in
--     src/modules/reports/application/projections/rebuild.ts (~line 183).
--   * SiteWeeklyTrend.weekStart is the ISO Monday (UTC), which matches
--     Postgres date_trunc('week', ...). SiteDailySummary/SiteWeeklyTrend
--     rebuilds include ALL reports (no status filter).

\echo ''
\echo '=== 1. Row counts: source of truth vs projections ==='
\echo 'Healthy: report_analytics = report_stats = reports;'
\echo '         site_daily = expected_daily; site_weekly = expected_weekly.'
SELECT
  (SELECT count(*) FROM "Report")                                    AS reports,
  (SELECT count(*) FROM "ReportAnalytics")                           AS report_analytics,
  (SELECT count(*) FROM "ReportStats")                               AS report_stats,
  (SELECT count(*) FROM "SiteDailySummary")                          AS site_daily,
  (SELECT count(DISTINCT ("siteId", "date")) FROM "Report")          AS expected_daily,
  (SELECT count(*) FROM "SiteWeeklyTrend")                           AS site_weekly,
  (SELECT count(DISTINCT ("siteId", date_trunc('week', "date"::date)))
     FROM "Report")                                                  AS expected_weekly;

\echo ''
\echo '=== 2. Reports MISSING their ReportAnalytics projection ==='
\echo 'Healthy: 0 rows. Rows here = projection worker missed events'
\echo '(check outbox backlog below, then rebuild via POST /api/admin/projections/rebuild).'
SELECT r."reportId", r."siteId", r."date", r.status, r."updatedAt"
FROM "Report" r
LEFT JOIN "ReportAnalytics" ra ON ra."reportId" = r."reportId"
WHERE ra."reportId" IS NULL
ORDER BY r."updatedAt" DESC
LIMIT 20;

\echo ''
\echo '=== 3. ORPHANED ReportAnalytics (projection exists, report deleted) ==='
\echo 'Healthy: 0 rows. Rows here = deletes were not reprojected'
\echo '(known bug class, data-flow audit 2026-07-07) — analytics overcounts.'
SELECT ra."reportId", ra."siteId", ra.status, ra."lastEventAt"
FROM "ReportAnalytics" ra
LEFT JOIN "Report" r ON r."reportId" = ra."reportId"
WHERE r."reportId" IS NULL
ORDER BY ra."lastEventAt" DESC
LIMIT 20;

\echo ''
\echo '=== 4. Same two checks for ReportStats ==='
\echo 'Healthy: both counts 0.'
SELECT
  (SELECT count(*)
     FROM "Report" r
     LEFT JOIN "ReportStats" rs ON rs."reportId" = r."reportId"
     WHERE rs."reportId" IS NULL)                                    AS reports_missing_stats,
  (SELECT count(*)
     FROM "ReportStats" rs
     LEFT JOIN "Report" r ON r."reportId" = rs."reportId"
     WHERE r."reportId" IS NULL)                                     AS orphaned_stats;

\echo ''
\echo '=== 5. SiteWeeklyTrend coverage per site ==='
\echo 'Healthy: missing_weeks = 0 per site. All rows missing = nightly'
\echo 'rebuild wiped the table and crashed (known prod failure mode:'
\echo 'NOT NULL tenantId drift) — rerun the rebuild.'
SELECT
  exp."siteId",
  s.name                                              AS site_name,
  exp.expected_weeks,
  coalesce(act.actual_weeks, 0)                       AS actual_weeks,
  exp.expected_weeks - coalesce(act.actual_weeks, 0)  AS missing_weeks
FROM (
  SELECT "siteId", count(DISTINCT date_trunc('week', "date"::date)) AS expected_weeks
  FROM "Report" GROUP BY "siteId"
) exp
LEFT JOIN (
  SELECT "siteId", count(*) AS actual_weeks
  FROM "SiteWeeklyTrend" GROUP BY "siteId"
) act ON act."siteId" = exp."siteId"
LEFT JOIN "Site" s ON s.id = exp."siteId"
ORDER BY missing_weeks DESC, exp."siteId";

\echo ''
\echo '=== 6. Outbox backlog (both consumer sides) ==='
\echo 'Healthy: unpublished ~0, unprojected ~0, oldest ages < 60s.'
\echo 'Growing backlog -> runbook docs/runbooks/004-outbox-backlog.md.'
SELECT
  count(*) FILTER (WHERE published = false)                          AS unpublished,
  count(*) FILTER (WHERE projected = false)                          AS unprojected,
  round(extract(epoch FROM now() - min("createdAt")
        FILTER (WHERE published = false)))                           AS oldest_unpublished_age_sec,
  round(extract(epoch FROM now() - min("createdAt")
        FILTER (WHERE projected = false)))                           AS oldest_unprojected_age_sec,
  count(*) FILTER (WHERE (published = false OR projected = false)
                   AND attempts >= 5)                                AS poison_candidates
FROM "OutboxEvent";

\echo ''
\echo '=== 7. Dead Letter Queue by status ==='
\echo 'Healthy: no pending rows. pending > 0 = a handler is failing'
\echo 'repeatedly; read errorMessage, fix the code, then retry via /api/admin/dlq.'
SELECT status, count(*), max("createdAt") AS newest
FROM "DeadLetterQueue"
GROUP BY status
ORDER BY status;

\echo ''
\echo '=== 8. Newest pending DLQ errors (what exactly is failing) ==='
SELECT "eventType", attempts, left("errorMessage", 100) AS error, "createdAt"
FROM "DeadLetterQueue"
WHERE status = 'pending'
ORDER BY "createdAt" DESC
LIMIT 10;
