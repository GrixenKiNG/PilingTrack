-- Add missing FK index on SitePilePlan.pileGradeId.
-- Without it Postgres does a sequential scan on SitePilePlan every time
-- a PileGrade row is updated/deleted (cascade fan-out), which also takes
-- a table-level lock. Rule #9 from project Postgres design doc.

CREATE INDEX IF NOT EXISTS "SitePilePlan_pileGradeId_idx"
  ON "SitePilePlan"("pileGradeId");
