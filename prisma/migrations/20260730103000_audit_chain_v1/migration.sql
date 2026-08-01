ALTER TABLE "AuditLog"
  ADD COLUMN "sequence" BIGINT,
  ADD COLUMN "occurredAt" TIMESTAMPTZ(3),
  ADD COLUMN "recordedAt" TIMESTAMPTZ(3),
  ADD COLUMN "actorId" TEXT,
  ADD COLUMN "actingAs" TEXT,
  ADD COLUMN "entityType" TEXT,
  ADD COLUMN "entityVersion" INTEGER,
  ADD COLUMN "correlationId" TEXT,
  ADD COLUMN "idempotencyKeyHash" BYTEA,
  ADD COLUMN "metadata" JSONB,
  ADD COLUMN "prevHash" BYTEA,
  ADD COLUMN "hash" BYTEA;

CREATE TABLE "TenantAuditChain" (
  "tenantId" TEXT NOT NULL,
  "lastSequence" BIGINT NOT NULL DEFAULT 0,
  "headHash" BYTEA,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TenantAuditChain_pkey" PRIMARY KEY ("tenantId"),
  CONSTRAINT "TenantAuditChain_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AuditLog_tenantId_sequence_key"
  ON "AuditLog" ("tenantId", "sequence");
CREATE UNIQUE INDEX "AuditLog_tenantId_hash_key"
  ON "AuditLog" ("tenantId", "hash");
CREATE INDEX "AuditLog_tenantId_occurredAt_id_idx"
  ON "AuditLog" ("tenantId", "occurredAt", "id");
CREATE INDEX "AuditLog_tenantId_entityType_entityId_occurredAt_idx"
  ON "AuditLog" ("tenantId", "entityType", "entityId", "occurredAt");
CREATE INDEX "AuditLog_tenantId_actorId_occurredAt_idx"
  ON "AuditLog" ("tenantId", "actorId", "occurredAt");
CREATE INDEX "AuditLog_tenantId_action_occurredAt_idx"
  ON "AuditLog" ("tenantId", "action", "occurredAt");

-- No approved legacy tenant mapping manifest exists in this slice. Keep the
-- v2 columns nullable and protect only native chained rows. A later verified
-- backfill migration may tighten these fields to NOT NULL and broaden the
-- trigger after unmapped rows are quarantined.
CREATE OR REPLACE FUNCTION reject_chained_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."hash" IS NOT NULL THEN
    RAISE EXCEPTION 'chained AuditLog rows are append-only'
      USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER "AuditLog_chained_append_only"
BEFORE UPDATE OR DELETE ON "AuditLog"
FOR EACH ROW EXECUTE FUNCTION reject_chained_audit_mutation();
