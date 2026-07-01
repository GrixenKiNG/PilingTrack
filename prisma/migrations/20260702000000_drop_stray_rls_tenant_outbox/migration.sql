-- "Tenant" and "OutboxEvent" had RLS *enabled* with zero policies. No migration
-- ever did that -- it was out-of-band drift from the old Step 4 of
-- scripts/apply-postgres-hardening.ts, whose ENABLE loop ran while every
-- CREATE POLICY silently failed (Postgres has no `CREATE POLICY IF NOT EXISTS`).
-- RLS-without-policies means default-deny for any non-owner role, a latent trap.
-- Neither table is tenant-scoped by the migration-owned RLS design (Tenant is the
-- registry itself; OutboxEvent is processed by system workers), so restore the
-- migration-defined state: RLS off. Idempotent -- DISABLE on a table without RLS
-- is a no-op.

ALTER TABLE "Tenant" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "OutboxEvent" DISABLE ROW LEVEL SECURITY;
