-- Maintenance plans (PM scheduler, P3). Additive, non-destructive.

-- CreateEnum
CREATE TYPE "PmTriggerType" AS ENUM ('HOURS', 'CALENDAR');

-- CreateTable
CREATE TABLE "MaintenancePlan" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "MaintenanceType" NOT NULL DEFAULT 'TO1',
    "triggerType" "PmTriggerType" NOT NULL,
    "intervalHours" INTEGER,
    "intervalDays" INTEGER,
    "leadTimeDays" INTEGER NOT NULL DEFAULT 7,
    "lastDoneHours" INTEGER,
    "lastDoneAt" TIMESTAMPTZ(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MaintenancePlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaintenancePlan_tenantId_idx" ON "MaintenancePlan"("tenantId");
CREATE INDEX "MaintenancePlan_equipmentId_idx" ON "MaintenancePlan"("equipmentId");
CREATE INDEX "MaintenancePlan_isActive_idx" ON "MaintenancePlan"("isActive");

-- AddForeignKey
ALTER TABLE "MaintenancePlan" ADD CONSTRAINT "MaintenancePlan_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
