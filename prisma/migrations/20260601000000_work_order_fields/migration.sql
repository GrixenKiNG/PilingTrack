-- Add work order fields to MaintenanceRecord.
--
-- Additive only: new enum values, new enum type, new columns, new indexes.
-- No DROP, no ALTER COLUMN, no destructive change.

-- AlterEnum: add ASSIGNED and ON_HOLD to MaintenanceStatus
ALTER TYPE "MaintenanceStatus" ADD VALUE IF NOT EXISTS 'ASSIGNED';
ALTER TYPE "MaintenanceStatus" ADD VALUE IF NOT EXISTS 'ON_HOLD';

-- CreateEnum
CREATE TYPE "MaintenancePriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');

-- AlterTable: add work order columns
ALTER TABLE "MaintenanceRecord"
  ADD COLUMN IF NOT EXISTS "priority"       "MaintenancePriority" NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN IF NOT EXISTS "assigneeId"     TEXT,
  ADD COLUMN IF NOT EXISTS "startedAt"      TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "laborHours"     DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "faultCause"     TEXT,
  ADD COLUMN IF NOT EXISTS "partsUsedText"  TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "closedById"     TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MaintenanceRecord_assigneeId_idx" ON "MaintenanceRecord"("assigneeId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MaintenanceRecord_priority_idx" ON "MaintenanceRecord"("priority");