-- Meter readings journal (engine-hours history). Additive, non-destructive.
-- Equipment.engineHoursTotal stays as a denormalized "latest reading" cache,
-- kept in sync by the meter-reading command.

-- CreateEnum
CREATE TYPE "MeterSource" AS ENUM ('MANUAL', 'TELEMETRY');

-- CreateTable
CREATE TABLE "MeterReading" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL,
    "engineHours" INTEGER NOT NULL,
    "source" "MeterSource" NOT NULL DEFAULT 'MANUAL',
    "recordedById" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeterReading_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MeterReading_tenantId_idx" ON "MeterReading"("tenantId");

-- CreateIndex
CREATE INDEX "MeterReading_equipmentId_recordedAt_idx" ON "MeterReading"("equipmentId", "recordedAt");

-- AddForeignKey
ALTER TABLE "MeterReading" ADD CONSTRAINT "MeterReading_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
