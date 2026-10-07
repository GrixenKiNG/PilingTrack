-- J8: период журнала забивки; shiftId не входит в фильтр журнала.
-- Один statement, без BEGIN: CREATE INDEX CONCURRENTLY запрещён в транзакции.
CREATE INDEX CONCURRENTLY "PileWork_tenantId_occurredAt_idx"
ON "PileWork" ("tenantId", "occurredAt");
