/*
  Warnings:

  - You are about to drop the column `journalPhotoMediaId` on the `Report` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "MaintenanceType" AS ENUM ('SCHEDULED', 'REPAIR', 'FAULT', 'INSPECTION');

-- CreateEnum
CREATE TYPE "MaintenanceStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- DropForeignKey
ALTER TABLE "DeviceKey" DROP CONSTRAINT "DeviceKey_telematicsDeviceId_fkey";

-- DropForeignKey
ALTER TABLE "EquipmentDocument" DROP CONSTRAINT "EquipmentDocument_equipmentId_fkey";

-- DropForeignKey
ALTER TABLE "TelematicsDevice" DROP CONSTRAINT "TelematicsDevice_equipmentId_fkey";

-- DropForeignKey
ALTER TABLE "TelematicsDevice" DROP CONSTRAINT "TelematicsDevice_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "TelematicsDeviceAssignment" DROP CONSTRAINT "TelematicsDeviceAssignment_deviceId_fkey";

-- DropForeignKey
ALTER TABLE "TelematicsDeviceAssignment" DROP CONSTRAINT "TelematicsDeviceAssignment_equipmentId_fkey";

-- AlterTable
ALTER TABLE "Report" DROP COLUMN "journalPhotoMediaId";

-- CreateTable
CREATE TABLE "MaintenanceRecord" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "type" "MaintenanceType" NOT NULL,
    "status" "MaintenanceStatus" NOT NULL DEFAULT 'PLANNED',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "scheduledAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "engineHoursAtService" INTEGER,
    "cost" DECIMAL(14,2),
    "performedBy" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MaintenanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MaintenanceRecord_tenantId_idx" ON "MaintenanceRecord"("tenantId");

-- CreateIndex
CREATE INDEX "MaintenanceRecord_equipmentId_idx" ON "MaintenanceRecord"("equipmentId");

-- CreateIndex
CREATE INDEX "MaintenanceRecord_status_idx" ON "MaintenanceRecord"("status");

-- CreateIndex
CREATE INDEX "MaintenanceRecord_scheduledAt_idx" ON "MaintenanceRecord"("scheduledAt");

-- AddForeignKey
ALTER TABLE "EquipmentDocument" ADD CONSTRAINT "EquipmentDocument_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRecord" ADD CONSTRAINT "MaintenanceRecord_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceKey" ADD CONSTRAINT "DeviceKey_telematicsDeviceId_fkey" FOREIGN KEY ("telematicsDeviceId") REFERENCES "TelematicsDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelematicsDevice" ADD CONSTRAINT "TelematicsDevice_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelematicsDevice" ADD CONSTRAINT "TelematicsDevice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelematicsDeviceAssignment" ADD CONSTRAINT "TelematicsDeviceAssignment_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "TelematicsDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelematicsDeviceAssignment" ADD CONSTRAINT "TelematicsDeviceAssignment_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
