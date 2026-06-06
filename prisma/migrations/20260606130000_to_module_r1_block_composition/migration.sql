-- CreateEnum
CREATE TYPE "HammerKind" AS ENUM ('HYDRAULIC', 'DIESEL', 'NONE');

-- CreateEnum
CREATE TYPE "BlockType" AS ENUM ('BASE', 'HAMMER', 'ROTARY');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MaintenanceType" ADD VALUE 'EO';
ALTER TYPE "MaintenanceType" ADD VALUE 'TO1';
ALTER TYPE "MaintenanceType" ADD VALUE 'TO2';
ALTER TYPE "MaintenanceType" ADD VALUE 'TO3';
ALTER TYPE "MaintenanceType" ADD VALUE 'SEASONAL';

-- AlterTable
ALTER TABLE "ChecklistTemplate" ADD COLUMN     "appliesToHammerKind" "HammerKind",
ADD COLUMN     "blockType" "BlockType" NOT NULL DEFAULT 'BASE';

-- AlterTable
ALTER TABLE "Equipment" ADD COLUMN     "hammerKind" "HammerKind" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "isCombined" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Inspection" ADD COLUMN     "maintenanceRecordId" TEXT;

-- CreateIndex
CREATE INDEX "ChecklistTemplate_tenantId_blockType_level_idx" ON "ChecklistTemplate"("tenantId", "blockType", "level");

-- CreateIndex
CREATE UNIQUE INDEX "Inspection_maintenanceRecordId_key" ON "Inspection"("maintenanceRecordId");

-- AddForeignKey
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_maintenanceRecordId_fkey" FOREIGN KEY ("maintenanceRecordId") REFERENCES "MaintenanceRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
