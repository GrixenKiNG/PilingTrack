-- Equipment Tenant Isolation
-- 1. Add tenantId to Equipment, backfill existing rows with 'orion', then drop the default.
ALTER TABLE "Equipment" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'orion';
ALTER TABLE "Equipment" ALTER COLUMN "tenantId" DROP DEFAULT;
CREATE INDEX "Equipment_tenantId_idx" ON "Equipment"("tenantId");

-- 2. RLS for Equipment
ALTER TABLE "Equipment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_equipment ON "Equipment"
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

-- 3. RLS for EquipmentDocument (tenantId column already exists)
ALTER TABLE "EquipmentDocument" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_equipmentdocument ON "EquipmentDocument"
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

-- 4. RLS for MaintenanceRecord (tenantId column already exists)
ALTER TABLE "MaintenanceRecord" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_maintenancerecord ON "MaintenanceRecord"
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
