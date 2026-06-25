-- Reconcile schema/DB drift on User.tenantId.
-- Prod (orionpiling.ru) already has this column as NOT NULL (the ALTER was
-- applied manually during tenancy hardening but never captured in a migration),
-- while prisma/schema.prisma still declared it nullable. That mismatch made the
-- create-user path insert NULL and surface an opaque 500 (hit 2026-06-17).
-- This migration formalizes the constraint so the type system catches it.
--   * On prod: SET NOT NULL on an already-NOT-NULL column is a no-op (idempotent).
--   * On local/CI: 0 NULL rows verified before applying.
ALTER TABLE "User" ALTER COLUMN "tenantId" SET NOT NULL;
