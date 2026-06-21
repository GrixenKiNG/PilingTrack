-- Pile length as a stored, normalized attribute of the grade (replaces parsing
-- the length out of PileGrade.name at runtime, which was duplicated across the
-- reports/dashboard/PDF code paths and silently diverged).
--
-- lengthMm is nullable: null = unknown length, treated as 0 m by callers — the
-- same result the old `name.match(/\d{3}/)/10` produced for unparseable names.

ALTER TABLE "PileGrade" ADD COLUMN "lengthMm" INTEGER;

-- Behaviour-preserving backfill: reproduce the old parse exactly.
-- Old logic: first 3-digit run in the name = decimetres, /10 = metres.
-- Stored here as millimetres, so decimetres * 100 (e.g. "С300" -> 300 dm -> 30000 mm = 30.0 m).
UPDATE "PileGrade"
SET "lengthMm" = (substring("name" from '\d{3}'))::int * 100
WHERE substring("name" from '\d{3}') IS NOT NULL;
