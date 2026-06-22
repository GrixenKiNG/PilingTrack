BEGIN;

-- Expand phase. The remap and NOT NULL enforcement are completed below in the
-- same migration before this file is deployed.
ALTER TABLE "PileGrade"
  ADD COLUMN "tenantId" TEXT,
  ADD COLUMN "normalizedName" TEXT,
  ADD COLUMN "code" TEXT,
  ADD COLUMN "sectionOrDiameter" TEXT,
  ADD COLUMN "notes" TEXT NOT NULL DEFAULT '';

ALTER TABLE "DrillingType"
  ADD COLUMN "tenantId" TEXT,
  ADD COLUMN "normalizedName" TEXT;

ALTER TABLE "DowntimeReason"
  ADD COLUMN "tenantId" TEXT,
  ADD COLUMN "normalizedName" TEXT;

ALTER TABLE "PileGrade"
  ADD CONSTRAINT "PileGrade_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DrillingType"
  ADD CONSTRAINT "DrillingType_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DowntimeReason"
  ADD CONSTRAINT "DowntimeReason_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "PileGrade_tenantId_normalizedName_key"
  ON "PileGrade"("tenantId", "normalizedName");
CREATE INDEX "PileGrade_tenantId_isActive_idx"
  ON "PileGrade"("tenantId", "isActive");

CREATE UNIQUE INDEX "DrillingType_tenantId_normalizedName_key"
  ON "DrillingType"("tenantId", "normalizedName");
CREATE INDEX "DrillingType_tenantId_isActive_idx"
  ON "DrillingType"("tenantId", "isActive");

CREATE UNIQUE INDEX "DowntimeReason_tenantId_normalizedName_key"
  ON "DowntimeReason"("tenantId", "normalizedName");
CREATE INDEX "DowntimeReason_tenantId_isActive_idx"
  ON "DowntimeReason"("tenantId", "isActive");

-- Refuse to guess ownership or silently merge duplicate labels.
DO $$
BEGIN
  IF (
    EXISTS (SELECT 1 FROM "PileGrade" WHERE "tenantId" IS NULL)
    OR EXISTS (SELECT 1 FROM "DrillingType" WHERE "tenantId" IS NULL)
    OR EXISTS (SELECT 1 FROM "DowntimeReason" WHERE "tenantId" IS NULL)
  ) AND NOT EXISTS (SELECT 1 FROM "Tenant") THEN
    RAISE EXCEPTION 'Tenant dictionary migration: dictionaries exist but no tenants were found';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "PileWork" pw
    JOIN "Report" r ON r."id" = pw."reportId"
    WHERE r."tenantId" IS NULL
  ) OR EXISTS (
    SELECT 1 FROM "LeaderDrilling" ld
    JOIN "Report" r ON r."id" = ld."reportId"
    WHERE r."tenantId" IS NULL
  ) OR EXISTS (
    SELECT 1 FROM "ReportDowntime" rd
    JOIN "Report" r ON r."id" = rd."reportId"
    WHERE r."tenantId" IS NULL
  ) THEN
    RAISE EXCEPTION 'Tenant dictionary migration: report dictionary link has no tenant';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "PileGrade"
    WHERE "tenantId" IS NULL
    GROUP BY regexp_replace(lower(btrim("name")), E'\\s+', ' ', 'g')
    HAVING COUNT(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM "DrillingType"
    WHERE "tenantId" IS NULL
    GROUP BY regexp_replace(lower(btrim("name")), E'\\s+', ' ', 'g')
    HAVING COUNT(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM "DowntimeReason"
    WHERE "tenantId" IS NULL
    GROUP BY regexp_replace(lower(btrim("name")), E'\\s+', ' ', 'g')
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Tenant dictionary migration: duplicate normalized dictionary names require manual resolution';
  END IF;
END $$;

CREATE TEMP TABLE "_dictionary_link_counts" AS
SELECT
  (SELECT COUNT(*) FROM "PileWork") AS "pileWork",
  (SELECT COUNT(*) FROM "LeaderDrilling") AS "leaderDrilling",
  (SELECT COUNT(*) FROM "ReportDowntime") AS "reportDowntime",
  (SELECT COUNT(*) FROM "SitePilePlan") AS "sitePilePlan";

CREATE TEMP TABLE "_pile_grade_map" (
  "oldId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "newId" TEXT NOT NULL PRIMARY KEY,
  UNIQUE ("oldId", "tenantId")
);
CREATE TEMP TABLE "_drilling_type_map" (
  "oldId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "newId" TEXT NOT NULL PRIMARY KEY,
  UNIQUE ("oldId", "tenantId")
);
CREATE TEMP TABLE "_downtime_reason_map" (
  "oldId" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "newId" TEXT NOT NULL PRIMARY KEY,
  UNIQUE ("oldId", "tenantId")
);

INSERT INTO "_pile_grade_map" ("oldId", "tenantId", "newId")
SELECT pg."id", t."id", 'pg_' || md5(pg."id" || ':' || t."id")
FROM "PileGrade" pg CROSS JOIN "Tenant" t
WHERE pg."tenantId" IS NULL;

INSERT INTO "_drilling_type_map" ("oldId", "tenantId", "newId")
SELECT dt."id", t."id", 'dt_' || md5(dt."id" || ':' || t."id")
FROM "DrillingType" dt CROSS JOIN "Tenant" t
WHERE dt."tenantId" IS NULL;

INSERT INTO "_downtime_reason_map" ("oldId", "tenantId", "newId")
SELECT dr."id", t."id", 'dr_' || md5(dr."id" || ':' || t."id")
FROM "DowntimeReason" dr CROSS JOIN "Tenant" t
WHERE dr."tenantId" IS NULL;

INSERT INTO "PileGrade" (
  "id", "tenantId", "name", "normalizedName", "code", "sectionOrDiameter",
  "notes", "isActive", "lengthMm", "createdAt", "updatedAt"
)
SELECT
  m."newId",
  m."tenantId",
  pg."name",
  regexp_replace(lower(btrim(pg."name")), E'\\s+', ' ', 'g'),
  COALESCE(NULLIF(pg."code", ''), pg."name"),
  pg."sectionOrDiameter",
  pg."notes",
  pg."isActive",
  pg."lengthMm",
  pg."createdAt",
  pg."updatedAt"
FROM "_pile_grade_map" m
JOIN "PileGrade" pg ON pg."id" = m."oldId";

INSERT INTO "DrillingType" (
  "id", "tenantId", "name", "normalizedName", "isActive", "createdAt", "updatedAt"
)
SELECT
  m."newId",
  m."tenantId",
  dt."name",
  regexp_replace(lower(btrim(dt."name")), E'\\s+', ' ', 'g'),
  dt."isActive",
  dt."createdAt",
  dt."updatedAt"
FROM "_drilling_type_map" m
JOIN "DrillingType" dt ON dt."id" = m."oldId";

INSERT INTO "DowntimeReason" (
  "id", "tenantId", "name", "normalizedName", "isActive", "createdAt", "updatedAt"
)
SELECT
  m."newId",
  m."tenantId",
  dr."name",
  regexp_replace(lower(btrim(dr."name")), E'\\s+', ' ', 'g'),
  dr."isActive",
  dr."createdAt",
  dr."updatedAt"
FROM "_downtime_reason_map" m
JOIN "DowntimeReason" dr ON dr."id" = m."oldId";

UPDATE "PileWork" pw
SET "pileGradeId" = m."newId"
FROM "Report" r, "_pile_grade_map" m
WHERE r."id" = pw."reportId"
  AND m."oldId" = pw."pileGradeId"
  AND m."tenantId" = r."tenantId";

UPDATE "SitePilePlan" sp
SET "pileGradeId" = m."newId"
FROM "Site" s, "_pile_grade_map" m
WHERE s."id" = sp."siteId"
  AND m."oldId" = sp."pileGradeId"
  AND m."tenantId" = s."tenantId";

UPDATE "LeaderDrilling" ld
SET "typeId" = m."newId"
FROM "Report" r, "_drilling_type_map" m
WHERE r."id" = ld."reportId"
  AND m."oldId" = ld."typeId"
  AND m."tenantId" = r."tenantId";

UPDATE "ReportDowntime" rd
SET "reasonId" = m."newId"
FROM "Report" r, "_downtime_reason_map" m
WHERE r."id" = rd."reportId"
  AND m."oldId" = rd."reasonId"
  AND m."tenantId" = r."tenantId";

DO $$
DECLARE counts RECORD;
BEGIN
  SELECT * INTO counts FROM "_dictionary_link_counts";
  IF counts."pileWork" <> (SELECT COUNT(*) FROM "PileWork")
    OR counts."leaderDrilling" <> (SELECT COUNT(*) FROM "LeaderDrilling")
    OR counts."reportDowntime" <> (SELECT COUNT(*) FROM "ReportDowntime")
    OR counts."sitePilePlan" <> (SELECT COUNT(*) FROM "SitePilePlan") THEN
    RAISE EXCEPTION 'Tenant dictionary migration: relationship counts changed';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "PileWork" pw
    JOIN "Report" r ON r."id" = pw."reportId"
    JOIN "PileGrade" d ON d."id" = pw."pileGradeId"
    WHERE d."tenantId" IS DISTINCT FROM r."tenantId"
  ) OR EXISTS (
    SELECT 1 FROM "SitePilePlan" sp
    JOIN "Site" s ON s."id" = sp."siteId"
    JOIN "PileGrade" d ON d."id" = sp."pileGradeId"
    WHERE d."tenantId" IS DISTINCT FROM s."tenantId"
  ) OR EXISTS (
    SELECT 1 FROM "LeaderDrilling" ld
    JOIN "Report" r ON r."id" = ld."reportId"
    JOIN "DrillingType" d ON d."id" = ld."typeId"
    WHERE d."tenantId" IS DISTINCT FROM r."tenantId"
  ) OR EXISTS (
    SELECT 1 FROM "ReportDowntime" rd
    JOIN "Report" r ON r."id" = rd."reportId"
    JOIN "DowntimeReason" d ON d."id" = rd."reasonId"
    WHERE d."tenantId" IS DISTINCT FROM r."tenantId"
  ) THEN
    RAISE EXCEPTION 'Tenant dictionary migration: cross-tenant or unresolved dictionary link remains';
  END IF;
END $$;

DELETE FROM "PileGrade" WHERE "tenantId" IS NULL;
DELETE FROM "DrillingType" WHERE "tenantId" IS NULL;
DELETE FROM "DowntimeReason" WHERE "tenantId" IS NULL;

ALTER TABLE "PileGrade"
  ALTER COLUMN "tenantId" SET NOT NULL,
  ALTER COLUMN "normalizedName" SET NOT NULL,
  ALTER COLUMN "code" SET DEFAULT '',
  ALTER COLUMN "code" SET NOT NULL;
ALTER TABLE "DrillingType"
  ALTER COLUMN "tenantId" SET NOT NULL,
  ALTER COLUMN "normalizedName" SET NOT NULL;
ALTER TABLE "DowntimeReason"
  ALTER COLUMN "tenantId" SET NOT NULL,
  ALTER COLUMN "normalizedName" SET NOT NULL;

COMMIT;
