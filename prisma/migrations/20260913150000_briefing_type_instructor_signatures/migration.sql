-- Вид инструктажа, инструктор, основание и две подписи в журнале инструктажей.
--
-- Все колонки НЕОБЯЗАТЕЛЬНЫЕ или со значением по умолчанию: в журнале уже
-- лежат боевые записи, и NOT NULL без значения по умолчанию уронил бы
-- миграцию на них. Заполнять прошлое задним числом нельзя — подписанный
-- журнал тем и ценен, что его не переписывают.

-- CreateEnum
CREATE TYPE "BriefingType" AS ENUM ('INDUCTION', 'PRIMARY', 'REPEAT', 'UNSCHEDULED', 'TARGETED');

-- AlterTable
ALTER TABLE "BriefingRecord"
  ADD COLUMN "type" "BriefingType",
  ADD COLUMN "instructorId" TEXT,
  ADD COLUMN "instructorName" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "reason" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "employeeSignedAt" TIMESTAMPTZ(3),
  ADD COLUMN "instructorSignedAt" TIMESTAMPTZ(3);

-- CreateIndex
CREATE INDEX "BriefingRecord_tenantId_type_recordedAt_idx" ON "BriefingRecord"("tenantId", "type", "recordedAt");
