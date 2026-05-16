-- Extend RLS to all remaining tenant-scoped tables.
-- Follows the audit-mode pattern from 20260425000000_enable_rls_foundation:
--   - permissive when app.current_tenant GUC is unset (backward compat),
--   - enforced when set.
-- After backfill in 20260516_audit_fix_tenancy all tenantId columns are NOT NULL,
-- so the IS NULL branch is retained only for future safety.

DO $$
DECLARE
  tbl TEXT;
  pol TEXT;
  tables TEXT[] := ARRAY[
    'AuditLog',
    'ConflictAudit',
    'DeviceKey',
    'DeviceSyncState',
    'DowntimeSummary',
    'Media',
    'OperatorPerformance',
    'ReportAnalytics',
    'ReportPhoto',
    'ReportStats',
    'SiteWeeklyTrend',
    'TenantInvoice'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    pol := 'tenant_isolation_' || lower(tbl);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    -- Drop existing policy with same name if rerun
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pol, tbl);
    EXECUTE format($f$
      CREATE POLICY %I ON %I
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
        )
    $f$, pol, tbl);
  END LOOP;
END $$;
