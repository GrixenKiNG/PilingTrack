DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "User" child
    LEFT JOIN "Tenant" parent ON parent."id" = child."tenantId"
    WHERE parent."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'readiness preflight: orphan User.tenantId values exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Equipment" child
    LEFT JOIN "Tenant" parent ON parent."id" = child."tenantId"
    WHERE parent."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'readiness preflight: orphan Equipment.tenantId values exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Site" child
    LEFT JOIN "Tenant" parent ON parent."id" = child."tenantId"
    WHERE child."tenantId" IS NOT NULL AND parent."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'readiness preflight: orphan Site.tenantId values exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "TenantSettings" child
    LEFT JOIN "Tenant" parent ON parent."id" = child."tenantId"
    WHERE parent."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'readiness preflight: orphan TenantSettings.tenantId values exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "TenantSettings" settings
    WHERE NULLIF(BTRIM(settings."timezone"), '') IS NOT NULL
      AND settings."timezone" <> 'UTC+3'
      AND NOT EXISTS (
        SELECT 1 FROM pg_timezone_names tz
        WHERE tz.name = settings."timezone"
      )
  ) THEN
    RAISE EXCEPTION 'readiness preflight: invalid IANA tenant timezone exists';
  END IF;

  IF EXISTS (
    SELECT "tenantId", "id" FROM "User"
    GROUP BY "tenantId", "id" HAVING COUNT(*) > 1
  ) OR EXISTS (
    SELECT "tenantId", "id" FROM "Equipment"
    GROUP BY "tenantId", "id" HAVING COUNT(*) > 1
  ) OR EXISTS (
    SELECT "tenantId", "id" FROM "Site"
    GROUP BY "tenantId", "id" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'readiness preflight: duplicate tenant parent key exists';
  END IF;
END $$;

UPDATE "TenantSettings"
SET "timezone" = 'Europe/Moscow'
WHERE NULLIF(BTRIM("timezone"), '') IS NULL OR "timezone" = 'UTC+3';

ALTER TABLE "TenantSettings"
  ALTER COLUMN "timezone" SET DEFAULT 'Europe/Moscow';

CREATE UNIQUE INDEX "User_tenantId_id_key"
  ON "User" ("tenantId", "id");
CREATE UNIQUE INDEX "Equipment_tenantId_id_key"
  ON "Equipment" ("tenantId", "id");
CREATE UNIQUE INDEX "Site_tenantId_id_key"
  ON "Site" ("tenantId", "id");

ALTER TABLE "TenantSettings"
  ADD CONSTRAINT "TenantSettings_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
