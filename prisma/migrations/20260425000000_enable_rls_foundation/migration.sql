-- Row-Level Security foundation for multi-tenant isolation.
--
-- Defense-in-depth alongside the application-layer tenantWhere() helpers in
-- src/core/security/tenant-enforcement.ts.
--
-- AUDIT MODE: the policy permits all rows when app.current_tenant is not set,
-- so existing queries continue to work. Code paths that opt in via
-- setPostgresTenantContext() get full enforcement. Once every query path is
-- wrapped, a follow-up migration will tighten the policy by removing the
-- `current_setting IS NULL OR ''` branches.
--
-- This migration covers the three highest-risk tables. Remaining tenant-scoped
-- models (AuditLog, DeviceKey, DeviceSyncState, ...) follow the same pattern
-- and are enabled in subsequent migrations after a per-table review.

-- ============================================================
-- Helper note
-- ============================================================
-- current_setting('app.current_tenant', true) returns NULL when the GUC is
-- not set on the current connection. The `true` flag prevents an error.

-- ============================================================
-- Report
-- ============================================================
ALTER TABLE "Report" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_report ON "Report"
  FOR ALL
  USING (
    -- Audit mode: allow when no tenant set on the connection
    current_setting('app.current_tenant', true) IS NULL
    OR current_setting('app.current_tenant', true) = ''
    -- System / legacy rows
    OR "tenantId" IS NULL
    -- Enforced match
    OR "tenantId" = current_setting('app.current_tenant', true)
  )
  WITH CHECK (
    current_setting('app.current_tenant', true) IS NULL
    OR current_setting('app.current_tenant', true) = ''
    OR "tenantId" IS NULL
    OR "tenantId" = current_setting('app.current_tenant', true)
  );

-- ============================================================
-- Site
-- ============================================================
ALTER TABLE "Site" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_site ON "Site"
  FOR ALL
  USING (
    current_setting('app.current_tenant', true) IS NULL
    OR current_setting('app.current_tenant', true) = ''
    OR "tenantId" IS NULL
    OR "tenantId" = current_setting('app.current_tenant', true)
  )
  WITH CHECK (
    current_setting('app.current_tenant', true) IS NULL
    OR current_setting('app.current_tenant', true) = ''
    OR "tenantId" IS NULL
    OR "tenantId" = current_setting('app.current_tenant', true)
  );

-- ============================================================
-- User
-- ============================================================
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_user ON "User"
  FOR ALL
  USING (
    current_setting('app.current_tenant', true) IS NULL
    OR current_setting('app.current_tenant', true) = ''
    OR "tenantId" IS NULL
    OR "tenantId" = current_setting('app.current_tenant', true)
  )
  WITH CHECK (
    current_setting('app.current_tenant', true) IS NULL
    OR current_setting('app.current_tenant', true) = ''
    OR "tenantId" IS NULL
    OR "tenantId" = current_setting('app.current_tenant', true)
  );
