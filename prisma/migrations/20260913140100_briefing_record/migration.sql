-- CreateEnum
CREATE TYPE "BriefingRecordKind" AS ENUM ('INSTRUCTION', 'KNOWLEDGE');

-- CreateTable
CREATE TABLE "BriefingRecord" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "BriefingRecordKind" NOT NULL,
    "userName" TEXT NOT NULL,
    "userRole" TEXT NOT NULL,
    "documentCode" TEXT NOT NULL,
    "documentTitle" TEXT NOT NULL,
    "documentVersion" TEXT NOT NULL,
    "correct" INTEGER,
    "total" INTEGER,
    "validUntil" TIMESTAMPTZ(3),
    "recordedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BriefingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BriefingRecord_tenantId_recordedAt_idx" ON "BriefingRecord"("tenantId", "recordedAt");

-- CreateIndex
CREATE INDEX "BriefingRecord_tenantId_userId_recordedAt_idx" ON "BriefingRecord"("tenantId", "userId", "recordedAt");

-- AddForeignKey
ALTER TABLE "BriefingRecord" ADD CONSTRAINT "BriefingRecord_tenantId_userId_fkey" FOREIGN KEY ("tenantId", "userId") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
