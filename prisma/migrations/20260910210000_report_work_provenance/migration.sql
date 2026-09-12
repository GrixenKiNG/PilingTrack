-- Restore missing provenance left by legacy report edits. No work or passport
-- is recreated: deleted executable documents require recovery from a backup.
UPDATE "PileWork" AS work SET
  "tenantId" = COALESCE(work."tenantId", report."tenantId"),
  "shiftId" = COALESCE(work."shiftId", report."shiftId")
FROM "Report" AS report WHERE work."reportId" = report."id"
  AND (work."tenantId" IS NULL AND report."tenantId" IS NOT NULL
    OR work."shiftId" IS NULL AND report."shiftId" IS NOT NULL);
UPDATE "LeaderDrilling" AS work SET
  "tenantId" = COALESCE(work."tenantId", report."tenantId"),
  "shiftId" = COALESCE(work."shiftId", report."shiftId")
FROM "Report" AS report WHERE work."reportId" = report."id"
  AND (work."tenantId" IS NULL AND report."tenantId" IS NOT NULL
    OR work."shiftId" IS NULL AND report."shiftId" IS NOT NULL);
UPDATE "ReportDowntime" AS work SET
  "tenantId" = COALESCE(work."tenantId", report."tenantId"),
  "shiftId" = COALESCE(work."shiftId", report."shiftId")
FROM "Report" AS report WHERE work."reportId" = report."id"
  AND (work."tenantId" IS NULL AND report."tenantId" IS NOT NULL
    OR work."shiftId" IS NULL AND report."shiftId" IS NOT NULL);
