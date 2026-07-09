-- MonitoringTileTemplate: per-tenant persisted dashboard tile layout for /monitoring. Additive.

-- CreateTable
CREATE TABLE "MonitoringTileTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "template" JSONB NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MonitoringTileTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MonitoringTileTemplate_tenantId_key" ON "MonitoringTileTemplate"("tenantId");

-- CreateIndex
CREATE INDEX "MonitoringTileTemplate_tenantId_idx" ON "MonitoringTileTemplate"("tenantId");

-- Tenant isolation: ENABLE + FORCE RLS, mirroring the current codebase-standard
-- policy form (see 20260603120100_checklist_engine_rls, the most recent
-- tenant-isolation migration for a NOT NULL tenantId column): fail-open when
-- app.current_tenant is unset/empty, strict equality otherwise. FORCE (not just
-- ENABLE) additionally applied per 20260701020000_force_row_level_security, so
-- the table-owner role does not bypass the policy.
ALTER TABLE "MonitoringTileTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MonitoringTileTemplate" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_monitoring_tile_template ON "MonitoringTileTemplate"
  FOR ALL
  USING (
    current_setting('app.current_tenant', true) IS NULL
    OR current_setting('app.current_tenant', true) = ''
    OR "tenantId" = current_setting('app.current_tenant', true)
  )
  WITH CHECK (
    current_setting('app.current_tenant', true) IS NULL
    OR current_setting('app.current_tenant', true) = ''
    OR "tenantId" = current_setting('app.current_tenant', true)
  );
