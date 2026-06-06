-- AlterTable
ALTER TABLE "MaintenanceRecord" ADD COLUMN     "acceptedAt" TIMESTAMPTZ(3),
ADD COLUMN     "acceptedById" TEXT,
ADD COLUMN     "workDone" TEXT NOT NULL DEFAULT '';
