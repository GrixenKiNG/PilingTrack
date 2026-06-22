-- Link crew assistants to their ASSISTANT user (optional). `name` stays as a
-- point-in-time snapshot so history survives a user rename/delete.

-- AlterTable
ALTER TABLE "CrewAssistant" ADD COLUMN "userId" TEXT;

-- CreateIndex
CREATE INDEX "CrewAssistant_userId_idx" ON "CrewAssistant"("userId");

-- AddForeignKey
ALTER TABLE "CrewAssistant" ADD CONSTRAINT "CrewAssistant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: link existing assistant rows to an ASSISTANT user when the name
-- matches EXACTLY ONE such user. Ambiguous duplicates stay unlinked.
UPDATE "CrewAssistant" ca
SET "userId" = u.id
FROM "User" u
WHERE u.name = ca.name
  AND u.role = 'ASSISTANT'
  AND (SELECT COUNT(*) FROM "User" u2 WHERE u2.name = ca.name AND u2.role = 'ASSISTANT') = 1;
