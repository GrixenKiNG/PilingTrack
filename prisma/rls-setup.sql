-- ============================================================
-- Row Level Security (RLS) for Multi-Tenant Isolation
-- ============================================================
-- This script enables RLS on all multi-tenant tables.
-- Each tenant can only access their own data.
-- 
-- Usage: Run after deploying to PostgreSQL production.
--   psql -U postgres -d pilingtrack -f prisma/rls-setup.sql
-- ============================================================

-- Enable RLS on all tenant-isolated tables
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Site" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Report" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReportAnalytics" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReportStats" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OperatorPerformance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DowntimeSummary" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SiteWeeklyTrend" ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Policy: Users can only see users from their tenant
-- ============================================================
CREATE POLICY tenant_isolation_users ON "User"
  USING ("tenantId" = current_setting('app.current_tenant_id', true));

-- ============================================================
-- Policy: Sites are isolated by tenant
-- ============================================================
CREATE POLICY tenant_isolation_sites ON "Site"
  USING ("tenantId" = current_setting('app.current_tenant_id', true));

-- ============================================================
-- Policy: Reports are isolated by tenant
-- ============================================================
CREATE POLICY tenant_isolation_reports ON "Report"
  USING ("tenantId" = current_setting('app.current_tenant_id', true));

-- ============================================================
-- Policy: Report analytics are isolated by tenant
-- ============================================================
CREATE POLICY tenant_isolation_analytics ON "ReportAnalytics"
  USING ("tenantId" = current_setting('app.current_tenant_id', true));

CREATE POLICY tenant_isolation_stats ON "ReportStats"
  USING ("tenantId" = current_setting('app.current_tenant_id', true));

-- ============================================================
-- Policy: Operator performance is isolated by tenant
-- ============================================================
CREATE POLICY tenant_isolation_operator ON "OperatorPerformance"
  USING ("tenantId" = current_setting('app.current_tenant_id', true));

-- ============================================================
-- Policy: Downtime summary is isolated by tenant
-- ============================================================
CREATE POLICY tenant_isolation_downtime ON "DowntimeSummary"
  USING ("tenantId" = current_setting('app.current_tenant_id', true));

-- ============================================================
-- Policy: Weekly trends are isolated by tenant
-- ============================================================
CREATE POLICY tenant_isolation_weekly ON "SiteWeeklyTrend"
  USING ("tenantId" = current_setting('app.current_tenant_id', true));

-- ============================================================
-- Helper function to set tenant context
-- ============================================================
-- Usage: SELECT set_tenant_context('tenant-uuid-here');
CREATE OR REPLACE FUNCTION set_tenant_context(tenant_id TEXT)
RETURNS void AS $$
BEGIN
  PERFORM set_config('app.current_tenant_id', tenant_id, false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- Helper function to get current tenant context
-- ============================================================
CREATE OR REPLACE FUNCTION get_current_tenant_id()
RETURNS TEXT AS $$
BEGIN
  RETURN current_setting('app.current_tenant_id', true);
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Note: For Prisma integration, set the tenant context
-- via connection pooler (PgBouncer) or application layer
-- using: SET app.current_tenant_id = 'tenant-uuid';
-- ============================================================
