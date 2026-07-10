-- Generalize MonitoringTileTemplate (one row per tenant) into
-- ModuleLayoutTemplate (one row per tenant per editable surface).
-- Existing monitoring rows are backfilled as surface 'monitoring-equipment-tile'.
-- RLS (ENABLE + FORCE + fail-open policy) is attached to the table and
-- survives the rename; the policy is renamed for consistency only.

ALTER TABLE "MonitoringTileTemplate" RENAME TO "ModuleLayoutTemplate";
ALTER TABLE "ModuleLayoutTemplate" RENAME CONSTRAINT "MonitoringTileTemplate_pkey" TO "ModuleLayoutTemplate_pkey";

ALTER TABLE "ModuleLayoutTemplate" ADD COLUMN "surfaceId" TEXT NOT NULL DEFAULT 'monitoring-equipment-tile';
ALTER TABLE "ModuleLayoutTemplate" ALTER COLUMN "surfaceId" DROP DEFAULT;

DROP INDEX "MonitoringTileTemplate_tenantId_key";
CREATE UNIQUE INDEX "ModuleLayoutTemplate_tenantId_surfaceId_key" ON "ModuleLayoutTemplate"("tenantId", "surfaceId");
ALTER INDEX "MonitoringTileTemplate_tenantId_idx" RENAME TO "ModuleLayoutTemplate_tenantId_idx";

ALTER POLICY tenant_isolation_monitoring_tile_template ON "ModuleLayoutTemplate"
  RENAME TO tenant_isolation_module_layout_template;
