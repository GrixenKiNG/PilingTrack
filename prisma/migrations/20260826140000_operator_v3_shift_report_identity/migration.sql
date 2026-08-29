DROP INDEX IF EXISTS "Report_userId_siteId_date_key";
DROP INDEX IF EXISTS "unique_user_site_date";
ALTER TABLE "Report" ADD COLUMN "endingEngineHours" INTEGER, ADD COLUMN "closingComment" TEXT, ADD COLUMN "submittedAt" TIMESTAMPTZ(3);
CREATE UNIQUE INDEX IF NOT EXISTS "Report_tenantId_shiftId_key" ON "Report"("tenantId","shiftId");
ALTER TABLE "Shift" ADD COLUMN "closeExceptionReason" TEXT;
