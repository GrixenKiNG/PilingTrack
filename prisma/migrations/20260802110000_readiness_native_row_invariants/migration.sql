-- Keep unmapped legacy rows readable while preventing new partial readiness
-- audit/idempotency records. NOT VALID deliberately skips historic rows; the
-- verified tenant backfill can validate and later tighten the columns.

ALTER TABLE "AuditLog"
  ADD CONSTRAINT "AuditLog_native_chain_complete"
  CHECK (
    "hash" IS NULL OR (
      "tenantId" IS NOT NULL
      AND "sequence" IS NOT NULL
      AND "occurredAt" IS NOT NULL
      AND "recordedAt" IS NOT NULL
      AND "entityType" IS NOT NULL
      AND "requestId" IS NOT NULL
      AND "correlationId" IS NOT NULL
      AND "metadata" IS NOT NULL
    )
  ) NOT VALID;

ALTER TABLE "IdempotencyKey"
  ADD CONSTRAINT "IdempotencyKey_tenant_claim_complete"
  CHECK (
    "tenantId" IS NULL OR (
      "actorId" IS NOT NULL
      AND "requestHash" IS NOT NULL
    )
  ) NOT VALID;

COMMENT ON CONSTRAINT "AuditLog_native_chain_complete" ON "AuditLog" IS
  'New chained readiness events must carry tenant, sequence, timestamps and correlation metadata; legacy unchained rows await verified backfill.';

COMMENT ON CONSTRAINT "IdempotencyKey_tenant_claim_complete" ON "IdempotencyKey" IS
  'New tenant-scoped command claims require actor and request hash; legacy global keys remain supported until backfill.';
