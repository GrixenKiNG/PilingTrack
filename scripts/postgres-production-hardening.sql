-- ============================================================
-- PostgreSQL Production Hardening
--
-- Применяется ПОСЛЕ Prisma миграции.
-- Добавляет:
-- 1. CHECK constraints (правило #13)
-- 2. Partial-индексы (правило #17)
-- 3. Мягкое удаление (правило #10)
-- 4. TIMESTAMPTZ исправления (правило #3)
-- 5. Row-Level Security (правило #25)
-- ============================================================

-- ============================================================
-- 1. CHECK CONSTRAINTS (правило #13)
-- ============================================================

-- Role constraint
ALTER TABLE "User" ADD CONSTRAINT chk_user_role_valid
  CHECK ("role" IN ('ADMIN', 'DISPATCHER', 'OPERATOR', 'ASSISTANT'));

-- Report status constraint
ALTER TABLE "Report" ADD CONSTRAINT chk_report_status_valid
  CHECK ("status" IN ('draft', 'submitted'));

-- Report shiftType constraint
ALTER TABLE "Report" ADD CONSTRAINT chk_report_shift_valid
  CHECK ("shiftType" IN ('DAY', 'NIGHT'));

-- Report date not in future
ALTER TABLE "Report" ADD CONSTRAINT chk_report_date_not_future
  CHECK ("date" <= CURRENT_DATE);

-- Downtime duration constraint
ALTER TABLE "ReportDowntime" ADD CONSTRAINT chk_downtime_duration_positive
  CHECK ("duration" >= 0);

-- PileWork count constraint
ALTER TABLE "PileWork" ADD CONSTRAINT chk_pile_count_positive
  CHECK ("count" > 0);

-- LeaderDrilling meters constraint
ALTER TABLE "LeaderDrilling" ADD CONSTRAINT chk_drilling_meters_positive
  CHECK ("meters" >= 0);

-- Equipment quantity constraint
ALTER TABLE "Equipment" ADD CONSTRAINT chk_equipment_qty_positive
  CHECK ("qty" > 0);

-- Site status constraint
ALTER TABLE "Site" ADD CONSTRAINT chk_site_status_valid
  CHECK ("status" IN ('ACTIVE', 'COMPLETED', 'ARCHIVED'));

-- FeedbackEvent level constraint
ALTER TABLE "FeedbackEvent" ADD CONSTRAINT chk_feedback_level_valid
  CHECK ("level" IN ('info', 'warn', 'error', 'success'));

-- FeedbackEvent priority constraint
ALTER TABLE "FeedbackEvent" ADD CONSTRAINT chk_feedback_priority_valid
  CHECK ("priority" IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'));

-- FeedbackEvent audience constraint
ALTER TABLE "FeedbackEvent" ADD CONSTRAINT chk_feedback_audience_valid
  CHECK ("audience" IN ('OPERATIONS', 'MANAGEMENT', 'TECHNICAL'));

-- OutboxEvent status constraint
ALTER TABLE "OutboxEvent" ADD CONSTRAINT chk_outbox_published
  CHECK ("published" IN (true, false));

-- IdempotencyKey status constraint
ALTER TABLE "IdempotencyKey" ADD CONSTRAINT chk_idempotency_status_valid
  CHECK ("status" IN ('pending', 'processing', 'completed', 'failed'));

-- RefreshToken constraint
ALTER TABLE "RefreshToken" ADD CONSTRAINT chk_refresh_token_not_revoked_or_has_reason
  CHECK (NOT "revoked" OR "revokedReason" IS NOT NULL OR "revokedAt" IS NOT NULL);

-- TelemetryRecord value constraint
ALTER TABLE "TelemetryRecord" ADD CONSTRAINT chk_telemetry_value_finite
  CHECK ("value" = "value" AND "value" != 'Infinity' AND "value" != '-Infinity');

-- ============================================================
-- 2. PARTIAL INDEXES (правило #17)
-- ============================================================

-- Active users only
CREATE INDEX idx_users_active_email ON "User"("email")
  WHERE "isActive" = true;

-- Active sites only
CREATE INDEX idx_sites_active ON "Site"("name")
  WHERE "isActive" = true;

-- Active equipment only
CREATE INDEX idx_equipment_active ON "Equipment"("name")
  WHERE "isActive" = true;

-- Active crews only
CREATE INDEX idx_crews_active ON "Crew"("name")
  WHERE "isActive" = true;

-- Active dictionaries only
CREATE INDEX idx_pile_grades_active ON "PileGrade"("name")
  WHERE "isActive" = true;

CREATE INDEX idx_drilling_types_active ON "DrillingType"("name")
  WHERE "isActive" = true;

CREATE INDEX idx_downtime_reasons_active ON "DowntimeReason"("name")
  WHERE "isActive" = true;

-- Pending outbox events (for polling worker)
CREATE INDEX idx_outbox_pending ON "OutboxEvent"("createdAt")
  WHERE "published" = false;

-- Unpublished outbox with retry limit
CREATE INDEX idx_outbox_retryable ON "OutboxEvent"("attempts", "createdAt")
  WHERE "published" = false AND "attempts" < 5;

-- Submitted reports (for analytics)
CREATE INDEX idx_reports_submitted ON "Report"("siteId", "date")
  WHERE "status" = 'submitted';

-- Draft reports (for editing)
CREATE INDEX idx_reports_draft ON "Report"("userId", "date")
  WHERE "status" = 'draft';

-- Failed idempotency keys (for cleanup)
CREATE INDEX idx_idempotency_failed ON "IdempotencyKey"("expiresAt")
  WHERE "status" = 'failed';

-- Expired refresh tokens (for cleanup)
CREATE INDEX idx_refresh_tokens_expired ON "RefreshToken"("expiresAt")
  WHERE "expiresAt" < NOW();

-- ============================================================
-- 3. SOFT DELETE COLUMNS (правило #10)
-- ============================================================

-- Note: These columns are OPTIONAL — application layer handles filtering.
-- Partial indexes above only index active rows.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE "Site" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE "Equipment" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE "Crew" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE "PileGrade" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE "DrillingType" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE "DowntimeReason" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMPTZ DEFAULT NULL;

-- Partial indexes for soft-delete
CREATE INDEX idx_users_not_deleted ON "User"("email")
  WHERE "deletedAt" IS NULL;

CREATE INDEX idx_sites_not_deleted ON "Site"("name")
  WHERE "deletedAt" IS NULL;

CREATE INDEX idx_equipment_not_deleted ON "Equipment"("name")
  WHERE "deletedAt" IS NULL;

-- ============================================================
-- 4. ROW-LEVEL SECURITY (правило #25)
-- ============================================================

-- Enable RLS
ALTER TABLE "Tenant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Site" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Report" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReportAnalytics" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReportStats" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OperatorPerformance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DowntimeSummary" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SiteWeeklyTrend" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OutboxEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TelemetryRecord" ENABLE ROW LEVEL SECURITY;

-- Tenant isolation policies
CREATE POLICY tenant_isolation_tenant ON "Tenant"
    USING (true);

CREATE POLICY tenant_isolation_user ON "User"
    USING (
      "tenantId" IS NULL
      OR "tenantId" = current_setting('app.current_tenant', true)
    );

CREATE POLICY tenant_isolation_site ON "Site"
    USING (
      "tenantId" IS NULL
      OR "tenantId" = current_setting('app.current_tenant', true)
    );

CREATE POLICY tenant_isolation_report ON "Report"
    USING (
      "tenantId" IS NULL
      OR "tenantId" = current_setting('app.current_tenant', true)
    );

CREATE POLICY tenant_isolation_analytics ON "ReportAnalytics"
    USING (
      "tenantId" IS NULL
      OR "tenantId" = current_setting('app.current_tenant', true)
    );

CREATE POLICY tenant_isolation_stats ON "ReportStats"
    USING (
      "tenantId" IS NULL
      OR "tenantId" = current_setting('app.current_tenant', true)
    );

CREATE POLICY tenant_isolation_operator ON "OperatorPerformance"
    USING (
      "tenantId" IS NULL
      OR "tenantId" = current_setting('app.current_tenant', true)
    );

CREATE POLICY tenant_isolation_downtime ON "DowntimeSummary"
    USING (
      "tenantId" IS NULL
      OR "tenantId" = current_setting('app.current_tenant', true)
    );

CREATE POLICY tenant_isolation_trend ON "SiteWeeklyTrend"
    USING (
      "tenantId" IS NULL
      OR "tenantId" = current_setting('app.current_tenant', true)
    );

CREATE POLICY tenant_isolation_audit ON "AuditLog"
    USING (
      "tenantId" IS NULL
      OR "tenantId" = current_setting('app.current_tenant', true)
    );

CREATE POLICY tenant_isolation_outbox ON "OutboxEvent"
    USING (
      "tenantId" IS NULL
      OR "tenantId" = current_setting('app.current_tenant', true)
    );

CREATE POLICY tenant_isolation_telemetry ON "TelemetryRecord"
    USING (
      "tenantId" IS NULL
      OR "tenantId" = current_setting('app.current_tenant', true)
    );

-- ============================================================
-- 5. POST-APPLY NOTES
-- ============================================================
--
-- After running this script:
--
-- 1. Update application code to use "deletedAt" instead of "isActive":
--    - Replace `isActive = true` with `deletedAt IS NULL`
--    - Replace `isActive = false` with `deletedAt IS NOT NULL`
--
-- 2. Set tenant context before queries:
--    SET app.current_tenant = 'tenant-id-here';
--
-- 3. Monitor partial index usage:
--    SELECT schemaname, tablename, indexname, idx_scan
--    FROM pg_stat_user_indexes
--    WHERE indexname LIKE 'idx_%_active%' OR indexname LIKE 'idx_%_not_deleted%';
--
-- 4. Run VACUUM ANALYZE after applying:
--    VACUUM ANALYZE;
--
