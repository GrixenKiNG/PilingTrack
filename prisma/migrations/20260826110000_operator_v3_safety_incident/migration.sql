-- Наблюдаемые признаки и доказательства существующего дефекта.
ALTER TABLE "EquipmentDefect"
  ADD COLUMN "observedSigns" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "safeStopApplied" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "classificationRuleId" TEXT,
  ADD COLUMN "classificationRuleVersion" TEXT,
  ADD COLUMN "evidenceMediaIds" JSONB NOT NULL DEFAULT '[]';

-- Опасное событие — отдельная деловая сущность, а не разновидность дефекта.
CREATE TABLE "SafetyIncident" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "shiftId" TEXT,
  "equipmentId" TEXT,
  "siteId" TEXT,
  "relatedDefectId" TEXT,
  "category" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "observedSigns" JSONB NOT NULL,
  "stopRequired" BOOLEAN NOT NULL,
  "emergencyStopApplied" BOOLEAN NOT NULL DEFAULT false,
  "injured" BOOLEAN NOT NULL DEFAULT false,
  "safeStateDescription" TEXT,
  "evidenceMediaIds" JSONB NOT NULL DEFAULT '[]',
  "classificationRuleId" TEXT NOT NULL,
  "classificationRuleVersion" TEXT NOT NULL,
  "stoppedAt" TIMESTAMPTZ(3),
  "stoppedById" TEXT,
  "resumeSnapshotId" TEXT,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL,
  "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reportedById" TEXT NOT NULL,
  "deviceId" TEXT,
  "clientCommandId" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "SafetyIncident_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SafetyIncident_tenantId_id_key"
  ON "SafetyIncident"("tenantId", "id");
CREATE UNIQUE INDEX "SafetyIncident_tenantId_clientCommandId_key"
  ON "SafetyIncident"("tenantId", "clientCommandId");
CREATE INDEX "SafetyIncident_tenantId_shiftId_state_idx"
  ON "SafetyIncident"("tenantId", "shiftId", "state");
CREATE INDEX "SafetyIncident_tenantId_equipmentId_occurredAt_idx"
  ON "SafetyIncident"("tenantId", "equipmentId", "occurredAt");
CREATE INDEX "SafetyIncident_tenantId_relatedDefectId_idx"
  ON "SafetyIncident"("tenantId", "relatedDefectId");
