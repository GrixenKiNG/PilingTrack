ALTER TABLE "Shift" ADD COLUMN "startSnapshotId" TEXT;

ALTER TABLE "Shift"
  ADD CONSTRAINT "Shift_startSnapshot_fkey"
  FOREIGN KEY ("tenantId", "startSnapshotId")
  REFERENCES "ReadinessScoreSnapshot" ("tenantId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "Shift_tenantId_startSnapshotId_idx"
  ON "Shift" ("tenantId", "startSnapshotId");
