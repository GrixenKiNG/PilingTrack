CREATE TABLE "RepairVerification" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "incidentId" TEXT NOT NULL,
  "shiftId" TEXT,
  "equipmentId" TEXT NOT NULL,
  "repairStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
  "repairSummary" TEXT,
  "repairedById" TEXT,
  "repairedAt" TIMESTAMPTZ(3),
  "verificationStatus" TEXT NOT NULL DEFAULT 'NOT_REQUESTED',
  "verificationRevision" INTEGER NOT NULL DEFAULT 0,
  "verifiedById" TEXT,
  "verifiedAt" TIMESTAMPTZ(3),
  "verificationNote" TEXT,
  "evidenceMediaIds" JSONB NOT NULL DEFAULT '[]',
  "readinessRequestedAt" TIMESTAMPTZ(3),
  "readinessSnapshotId" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "RepairVerification_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RepairVerification_tenantId_incidentId_key" ON "RepairVerification"("tenantId","incidentId");
CREATE UNIQUE INDEX "RepairVerification_tenantId_id_key" ON "RepairVerification"("tenantId","id");
CREATE INDEX "RepairVerification_tenantId_equipmentId_updatedAt_idx" ON "RepairVerification"("tenantId","equipmentId","updatedAt");
