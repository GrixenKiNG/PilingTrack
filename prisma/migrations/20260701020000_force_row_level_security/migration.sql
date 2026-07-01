-- ENABLE ROW LEVEL SECURITY does not apply to the table owner (the role that
-- created the table -- same role the app and any direct psql/admin session use
-- here). Without FORCE, that role bypasses every tenant_isolation_* policy
-- entirely, so RLS was effectively decorative for any owner-role connection.
-- FORCE closes that gap without changing policy logic (superusers still
-- always bypass RLS, per Postgres semantics -- that's unrelated to FORCE).
--
-- Note: this does NOT change the existing fail-open behavior of the policies
-- themselves (current_setting('app.current_tenant', true) IS NULL OR ... ),
-- which still allow all rows when the session var isn't set. That's a
-- separate, larger decision (would require auditing every raw-SQL/admin path
-- that doesn't set app.current_tenant) and is intentionally out of scope here.

DO $$
DECLARE
  tbl TEXT;
  tables TEXT[] := ARRAY[
    'Report', 'Site', 'User',
    'Equipment', 'EquipmentDocument', 'MaintenanceRecord',
    'TelegramConfig', 'TelemetryRecord',
    'ChecklistTemplate', 'ChecklistSection', 'ChecklistItem', 'Inspection', 'InspectionAnswer',
    'AuditLog', 'ConflictAudit', 'DeviceKey', 'DeviceSyncState', 'DowntimeSummary',
    'Media', 'OperatorPerformance', 'ReportAnalytics', 'ReportPhoto', 'ReportStats',
    'SiteWeeklyTrend', 'TenantInvoice'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
  END LOOP;
END $$;
