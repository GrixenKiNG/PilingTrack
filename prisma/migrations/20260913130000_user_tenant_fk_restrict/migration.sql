-- User.tenantId is NOT NULL, so ON DELETE SET NULL could never succeed:
-- deleting a Tenant raised a not-null violation instead of a clean refusal.
-- RESTRICT is the behaviour the column already implied.
ALTER TABLE "User" DROP CONSTRAINT "User_tenantId_fkey";
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
