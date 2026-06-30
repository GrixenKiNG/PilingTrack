-- TelemetryRecord Tenant Isolation
-- 1. Add tenantId to TelemetryRecord, backfill existing rows with 'orion', then drop the default.
ALTER TABLE "TelemetryRecord" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'orion';
ALTER TABLE "TelemetryRecord" ALTER COLUMN "tenantId" DROP DEFAULT;
CREATE INDEX "TelemetryRecord_tenantId_idx" ON "TelemetryRecord"("tenantId");

-- 2. RLS for TelemetryRecord
ALTER TABLE "TelemetryRecord" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_telemetryrecord ON "TelemetryRecord"
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
