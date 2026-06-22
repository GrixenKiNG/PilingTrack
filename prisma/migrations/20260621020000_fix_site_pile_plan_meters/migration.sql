-- Data fix: align SitePilePlan.metersPerUnit to the grade's actual length where
-- they disagree. metersPerUnit is a planning figure that must equal the pile
-- length, but a few rows held bad values (e.g. 123 m/pile for a 12 m grade,
-- 12 vs 11, 15 vs 10).
--
-- Pile-meter KPI no longer reads this column (length comes from PileGrade.lengthMm
-- since migration 20260621010000 + src/lib/pile-length.ts), but planning screens
-- still display metersPerUnit, so it must be correct.
--
-- Idempotent: only touches rows that differ and whose grade has a known length.
UPDATE "SitePilePlan" sp
SET "metersPerUnit" = pg."lengthMm"::float / 1000
FROM "PileGrade" pg
WHERE sp."pileGradeId" = pg."id"
  AND pg."lengthMm" IS NOT NULL
  AND abs(sp."metersPerUnit" - pg."lengthMm"::float / 1000) > 0.001;
