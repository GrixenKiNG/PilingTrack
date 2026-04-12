-- ============================================================
-- Database Index Optimization — PilingTrack
-- ============================================================
-- Run: npx prisma db execute --file prisma/indexes.sql --schema prisma/schema.postgres.prisma
--
-- These indexes are critical for production performance.
-- Most queries filter by (siteId, date), (userId, date), or status.

-- ============================================================
-- Report Queries (highest traffic)
-- ============================================================

-- Composite index for site period queries (most common)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_report_site_date
  ON "Report"("siteId", "date" DESC);

-- Composite index for user reports
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_report_user_date
  ON "Report"("userId", "date" DESC);

-- Status filter (draft/submitted filter)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_report_status
  ON "Report"("status");

-- Updated at for sync/pull queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_report_updated
  ON "Report"("updatedAt" DESC);

-- Crew and equipment lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_report_crew
  ON "Report"("crewId") WHERE "crewId" IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_report_equipment
  ON "Report"("equipmentId") WHERE "equipmentId" IS NOT NULL;

-- ============================================================
-- Report Children (for aggregations)
-- ============================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pilework_report
  ON "PileWork"("reportId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_drilling_report
  ON "LeaderDrilling"("reportId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_downtime_report
  ON "ReportDowntime"("reportId");

-- ============================================================
-- User Access
-- ============================================================

-- Already has unique index on (userId, siteId)
-- Add non-unique index for reverse lookups
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_usersite_user
  ON "UserSiteAssignment"("userId");

-- ============================================================
-- Telemetry (high-write table)
-- ============================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_telemetry_equip_ts
  ON "TelemetryRecord"("equipmentId", "timestamp" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_telemetry_site_ts
  ON "TelemetryRecord"("siteId", "timestamp" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_telemetry_type_ts
  ON "TelemetryRecord"("type", "timestamp" DESC);

-- ============================================================
-- Audit Log (append-only, read-heavy)
-- ============================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_auditlog_entity_ts
  ON "AuditLog"("entity", "timestamp" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_auditlog_user_ts
  ON "AuditLog"("userId", "timestamp" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_auditlog_action_ts
  ON "AuditLog"("action", "timestamp" DESC);

-- ============================================================
-- Outbox (background worker)
-- ============================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_outbox_published
  ON "OutboxEvent"("published", "createdAt")
  WHERE published = false;

-- ============================================================
-- Refresh Tokens
-- ============================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_refreshtoken_user_active
  ON "RefreshToken"("userId")
  WHERE revoked = false;

-- ============================================================
-- Feedback Events
-- ============================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_feedback_scope_ts
  ON "FeedbackEvent"("scope", "createdAt" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_feedback_audience_ts
  ON "FeedbackEvent"("audience", "createdAt" DESC);

-- ============================================================
-- CQRS Read Projections
-- ============================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_report_analytics_site
  ON "ReportAnalytics"("siteId", "status");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_site_daily_date
  ON "SiteDailySummary"("siteId", "date");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_report_stats_site_date
  ON "ReportStats"("siteId", "date");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_operator_perf_user_date
  ON "OperatorPerformance"("userId", "date");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_downtime_summary_site_date
  ON "DowntimeSummary"("siteId", "date");

-- ============================================================
-- Verify indexes
-- ============================================================

-- SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'Report' ORDER BY indexname;
