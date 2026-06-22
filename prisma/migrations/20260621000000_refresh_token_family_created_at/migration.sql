-- Add familyCreatedAt to RefreshToken to enforce the 90-day family max-lifetime.
--
-- Additive only: one new column with a DEFAULT. No DROP, no destructive change.
--
-- The per-token `expiresAt` (30d) only caps a single token; it cannot stop a
-- stolen-and-rotated token chain from living forever, since each rotation mints
-- a fresh 30d token. `familyCreatedAt` anchors the family's birth time and is
-- carried forward unchanged on every rotation, so the family ages out at 90d
-- regardless of how many times it rotates.
--
-- Existing rows backfill to now(): pre-existing families restart their 90-day
-- clock at deploy time. Fail-safe (slightly lenient), not fail-open.

ALTER TABLE "RefreshToken"
  ADD COLUMN IF NOT EXISTS "familyCreatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now();
