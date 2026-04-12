-- ============================================================
-- Row-Level Security (RLS) Initialization
--
-- This script is run once on first database initialization.
-- It enables RLS on all tenant-aware tables.
-- ============================================================

-- Enable RLS on core tables
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

-- ============================================================
-- Tenant Isolation Policy
-- All users can only see data for their tenant.
-- Admins can see all (handled in application layer).
-- ============================================================

CREATE POLICY tenant_isolation_tenant ON "Tenant"
    USING (true); -- Tenants themselves are not scoped

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
-- Note: RLS is an insurance policy.
-- The application layer MUST set app.current_tenant before queries.
-- See: src/core/security/tenant-enforcement.ts → setPostgresTenantContext()
-- ============================================================
