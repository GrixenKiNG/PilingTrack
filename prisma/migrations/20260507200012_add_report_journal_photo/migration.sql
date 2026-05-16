-- Idempotent backfill for a migration that was applied to local + prod DBs
-- but whose file was never committed. Recreating it so Prisma's migration
-- history matches the actual schema state on every environment.

ALTER TABLE "Report" ADD COLUMN IF NOT EXISTS "journalPhotoMediaId" TEXT;
