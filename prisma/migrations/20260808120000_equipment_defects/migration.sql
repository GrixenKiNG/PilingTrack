-- Журнал дефектов техники.
-- Дефект — наблюдение оператора («что не так»). Наряд (MaintenanceRecord) —
-- работа по устранению («что делаем»). Раньше обе роли играл наряд типа
-- REPAIR/FAULT, поэтому замечание нельзя было зафиксировать, не открыв ремонт.

CREATE TYPE "DefectSeverity" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');
CREATE TYPE "DefectStatus" AS ENUM ('OPEN', 'IN_WORK', 'CLOSED', 'REJECTED');

CREATE TABLE "EquipmentDefect" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "severity" "DefectSeverity" NOT NULL DEFAULT 'NORMAL',
    "status" "DefectStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "node" TEXT,
    "reportedById" TEXT NOT NULL,
    "reportedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inspectionId" TEXT,
    "shiftId" TEXT,
    "triagedById" TEXT,
    "triagedAt" TIMESTAMPTZ(3),
    "maintenanceRecordId" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMPTZ(3),
    "resolution" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "EquipmentDefect_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EquipmentDefect_tenantId_id_key"
  ON "EquipmentDefect"("tenantId", "id");
CREATE INDEX "EquipmentDefect_tenantId_equipmentId_status_idx"
  ON "EquipmentDefect"("tenantId", "equipmentId", "status");
CREATE INDEX "EquipmentDefect_tenantId_status_severity_idx"
  ON "EquipmentDefect"("tenantId", "status", "severity");
CREATE INDEX "EquipmentDefect_tenantId_reportedAt_idx"
  ON "EquipmentDefect"("tenantId", "reportedAt");
CREATE INDEX "EquipmentDefect_tenantId_maintenanceRecordId_idx"
  ON "EquipmentDefect"("tenantId", "maintenanceRecordId");
CREATE INDEX "EquipmentDefect_equipmentId_idx"
  ON "EquipmentDefect"("equipmentId");

-- Удаление установки с незакрытыми дефектами должно падать, а не уносить
-- журнал молча: политика проекта — RESTRICT, а не CASCADE.
ALTER TABLE "EquipmentDefect"
  ADD CONSTRAINT "EquipmentDefect_equipmentId_fkey"
  FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Изоляция тенанта на уровне БД, как у Equipment и MaintenanceRecord.
-- Ветку "tenantId" IS NULL не добавляем: колонка NOT NULL с рождения.
ALTER TABLE "EquipmentDefect" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EquipmentDefect" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_equipmentdefect ON "EquipmentDefect"
  FOR ALL
  USING (
    current_setting('app.current_tenant', true) IS NULL
    OR current_setting('app.current_tenant', true) = ''
    OR "tenantId" = current_setting('app.current_tenant', true)
  );
