CREATE TABLE "CurrentReadiness" (
  "tenantId" TEXT NOT NULL,
  "equipmentId" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "score" INTEGER NOT NULL,
  "calculatedAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CurrentReadiness_pkey" PRIMARY KEY ("tenantId", "equipmentId"),
  CONSTRAINT "CurrentReadiness_score_range" CHECK ("score" BETWEEN 0 AND 100),
  CONSTRAINT "CurrentReadiness_snapshot_fkey" FOREIGN KEY ("tenantId", "snapshotId")
    REFERENCES "ReadinessScoreSnapshot" ("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "CurrentReadiness_tenantId_status_calculatedAt_idx"
  ON "CurrentReadiness" ("tenantId", "status", "calculatedAt");
CREATE INDEX "CurrentReadiness_tenantId_snapshotId_idx"
  ON "CurrentReadiness" ("tenantId", "snapshotId");

CREATE TABLE "ReadinessBackfillProgress" (
  "tenantId" TEXT NOT NULL,
  "lastEquipmentId" TEXT,
  "processedCount" INTEGER NOT NULL DEFAULT 0,
  "errorCount" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "status" TEXT NOT NULL DEFAULT 'RUNNING',
  "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMPTZ(3),
  CONSTRAINT "ReadinessBackfillProgress_pkey" PRIMARY KEY ("tenantId")
);

CREATE INDEX "ReadinessBackfillProgress_status_updatedAt_idx"
  ON "ReadinessBackfillProgress" ("status", "updatedAt");
