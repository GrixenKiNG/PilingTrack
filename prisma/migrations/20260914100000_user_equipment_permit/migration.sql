-- Матрица допусков работника к технике: человек × вид техники × вид работ.
--
-- Таблица новая и пустая: заполняется руками инженера ОТ. Ничего не
-- перестраивается и не переносится — прежних данных об этом в продукте нет.

-- CreateEnum
CREATE TYPE "EquipmentWorkScope" AS ENUM ('OPERATION', 'ASSEMBLY', 'MAINTENANCE', 'RIGGING', 'SUPPORT');

-- CreateEnum
CREATE TYPE "EquipmentPermitStatus" AS ENUM ('ALLOWED', 'LIMITED', 'DENIED');

-- CreateTable
CREATE TABLE "UserEquipmentPermit" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "equipmentKind" "EquipmentKind" NOT NULL,
    "equipmentModel" TEXT NOT NULL DEFAULT '',
    "scope" "EquipmentWorkScope" NOT NULL,
    "status" "EquipmentPermitStatus" NOT NULL DEFAULT 'ALLOWED',
    "restriction" TEXT NOT NULL DEFAULT '',
    "validUntil" TIMESTAMPTZ(3),
    "notes" TEXT NOT NULL DEFAULT '',
    "grantedById" TEXT,
    "grantedByName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "UserEquipmentPermit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserEquipmentPermit_tenantId_userId_equipmentKind_equipmentM_key"
  ON "UserEquipmentPermit"("tenantId", "userId", "equipmentKind", "equipmentModel", "scope");

-- CreateIndex
CREATE INDEX "UserEquipmentPermit_tenantId_userId_idx" ON "UserEquipmentPermit"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "UserEquipmentPermit_tenantId_validUntil_idx" ON "UserEquipmentPermit"("tenantId", "validUntil");

-- AddForeignKey
-- Restrict, как у остальных строк, висящих на работнике: удаление учётки с
-- живыми допусками должно упереться, а не унести их молча.
ALTER TABLE "UserEquipmentPermit" ADD CONSTRAINT "UserEquipmentPermit_tenantId_userId_fkey"
  FOREIGN KEY ("tenantId", "userId") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================
-- RLS: строгая политика, как на PilePassport, FuelLog и остальных.
-- Строгое равенство без «ИЛИ тенант не задан» — этим шаблоном в продукте уже
-- случался IDOR (31.05.2026).
-- ============================================================
ALTER TABLE "UserEquipmentPermit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UserEquipmentPermit" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation_user_equipment_permit" ON "UserEquipmentPermit";
CREATE POLICY "tenant_isolation_user_equipment_permit" ON "UserEquipmentPermit" FOR ALL
  USING ("tenantId" = current_setting('app.current_tenant', true));
