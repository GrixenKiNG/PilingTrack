ALTER TABLE "PileWork"
  ADD COLUMN "tenantId" TEXT,
  ADD COLUMN "shiftId" TEXT,
  ADD COLUMN "clientCommandId" TEXT,
  ADD COLUMN "workTypeId" TEXT,
  ADD COLUMN "depth" DOUBLE PRECISION,
  ADD COLUMN "workStartedAt" TIMESTAMPTZ(3),
  ADD COLUMN "workEndedAt" TIMESTAMPTZ(3),
  ADD COLUMN "result" TEXT,
  ADD COLUMN "comment" TEXT,
  ADD COLUMN "correctionReason" TEXT,
  ADD COLUMN "occurredAt" TIMESTAMPTZ(3),
  ADD COLUMN "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE UNIQUE INDEX "PileWork_tenantId_clientCommandId_key" ON "PileWork"("tenantId", "clientCommandId");
CREATE INDEX "PileWork_tenantId_shiftId_occurredAt_idx" ON "PileWork"("tenantId", "shiftId", "occurredAt");

ALTER TABLE "LeaderDrilling"
  ADD COLUMN "tenantId" TEXT,
  ADD COLUMN "shiftId" TEXT,
  ADD COLUMN "clientCommandId" TEXT,
  ADD COLUMN "occurredAt" TIMESTAMPTZ(3),
  ADD COLUMN "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE UNIQUE INDEX "LeaderDrilling_tenantId_clientCommandId_key" ON "LeaderDrilling"("tenantId", "clientCommandId");
CREATE INDEX "LeaderDrilling_tenantId_shiftId_occurredAt_idx" ON "LeaderDrilling"("tenantId", "shiftId", "occurredAt");

ALTER TABLE "ReportDowntime"
  ALTER COLUMN "reasonId" DROP NOT NULL,
  ALTER COLUMN "duration" SET DEFAULT 0,
  ADD COLUMN "tenantId" TEXT,
  ADD COLUMN "shiftId" TEXT,
  ADD COLUMN "clientCommandId" TEXT,
  ADD COLUMN "kind" TEXT,
  ADD COLUMN "status" TEXT,
  ADD COLUMN "startedAt" TIMESTAMPTZ(3),
  ADD COLUMN "endedAt" TIMESTAMPTZ(3),
  ADD COLUMN "durationSeconds" INTEGER,
  ADD COLUMN "reasonText" TEXT,
  ADD COLUMN "category" TEXT,
  ADD COLUMN "sourceResponsibility" TEXT,
  ADD COLUMN "defectId" TEXT,
  ADD COLUMN "maintenanceRecordId" TEXT,
  ADD COLUMN "occurredAt" TIMESTAMPTZ(3),
  ADD COLUMN "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX "ReportDowntime_tenantId_clientCommandId_key" ON "ReportDowntime"("tenantId", "clientCommandId");
CREATE INDEX "ReportDowntime_tenantId_shiftId_status_idx" ON "ReportDowntime"("tenantId", "shiftId", "status");
CREATE UNIQUE INDEX "ReportDowntime_one_open_interval_per_shift"
  ON "ReportDowntime"("tenantId", "shiftId")
  WHERE "status" = 'OPEN' AND "kind" IN ('BREAK', 'DOWNTIME');
