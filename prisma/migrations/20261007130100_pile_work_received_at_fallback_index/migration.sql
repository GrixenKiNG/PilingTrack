-- J8: период старых записей, у которых отсутствует occurredAt.
-- Отдельная миграция сохраняет autocommit для CREATE INDEX CONCURRENTLY.
CREATE INDEX CONCURRENTLY "PileWork_tenantId_receivedAt_null_occurredAt_idx"
ON "PileWork" ("tenantId", "receivedAt") WHERE "occurredAt" IS NULL;
