CREATE TABLE "ReadinessScoreSnapshot" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "equipmentId" TEXT NOT NULL,
  "shiftId" TEXT,
  "ruleSetId" TEXT NOT NULL,
  "ruleSetVersion" TEXT NOT NULL,
  "triggerType" TEXT NOT NULL,
  "triggerId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "score" INTEGER NOT NULL,
  "blockers" JSONB NOT NULL,
  "warnings" JSONB NOT NULL,
  "evidence" JSONB NOT NULL,
  "factsHash" BYTEA NOT NULL,
  "calculatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReadinessScoreSnapshot_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReadinessScoreSnapshot_score_range" CHECK ("score" BETWEEN 0 AND 100)
);

ALTER TABLE "OutboxEvent"
  ADD COLUMN "tenantId" TEXT,
  ADD COLUMN "dedupeKey" TEXT;

ALTER TABLE "IdempotencyKey"
  ADD COLUMN "tenantId" TEXT,
  ADD COLUMN "actorId" TEXT,
  ADD COLUMN "requestHash" BYTEA,
  ADD COLUMN "responseHeaders" JSONB;

CREATE UNIQUE INDEX "ReadinessScoreSnapshot_tenantId_equipmentId_triggerType_triggerId_key"
  ON "ReadinessScoreSnapshot" ("tenantId", "equipmentId", "triggerType", "triggerId");
CREATE UNIQUE INDEX "ReadinessScoreSnapshot_tenantId_id_key"
  ON "ReadinessScoreSnapshot" ("tenantId", "id");
CREATE INDEX "ReadinessScoreSnapshot_tenantId_equipmentId_calculatedAt_idx"
  ON "ReadinessScoreSnapshot" ("tenantId", "equipmentId", "calculatedAt");
CREATE INDEX "ReadinessScoreSnapshot_tenantId_status_calculatedAt_idx"
  ON "ReadinessScoreSnapshot" ("tenantId", "status", "calculatedAt");
CREATE INDEX "ReadinessScoreSnapshot_tenantId_shiftId_calculatedAt_idx"
  ON "ReadinessScoreSnapshot" ("tenantId", "shiftId", "calculatedAt");

CREATE UNIQUE INDEX "OutboxEvent_tenantId_dedupeKey_key"
  ON "OutboxEvent" ("tenantId", "dedupeKey");
CREATE INDEX "OutboxEvent_tenantId_projected_createdAt_idx"
  ON "OutboxEvent" ("tenantId", "projected", "createdAt");

CREATE UNIQUE INDEX "IdempotencyKey_tenantId_scope_key_key"
  ON "IdempotencyKey" ("tenantId", "scope", "key");
CREATE INDEX "IdempotencyKey_tenantId_actorId_createdAt_idx"
  ON "IdempotencyKey" ("tenantId", "actorId", "createdAt");

-- Existing rows deliberately stay nullable. Tenant and request-hash values
-- cannot be reconstructed safely without an approved mapping manifest.
