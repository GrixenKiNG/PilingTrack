-- Equipment — full metadata.
--
-- Adds identification, technical-spec and operation columns plus a
-- dedicated EquipmentDocument table for paspport/OTS/insurance/etc.
-- Backfills what we know from the existing seven rigs.

-- ============================================================
-- 1. Enums
-- ============================================================
CREATE TYPE "EquipmentKind" AS ENUM (
  'PILE_DRIVER',
  'DRILLING_RIG',
  'VIBRO_HAMMER',
  'HYBRID',
  'OTHER'
);

CREATE TYPE "EquipmentDocumentType" AS ENUM (
  'PASSPORT',
  'OTS',
  'INSURANCE',
  'INSPECTION',
  'CERTIFICATE',
  'MAINTENANCE_LOG',
  'OTHER'
);

-- ============================================================
-- 2. Equipment columns
-- ============================================================
ALTER TABLE "Equipment"
  -- A. Identification
  ADD COLUMN "inventoryNumber"    TEXT,
  ADD COLUMN "registrationNumber" TEXT,
  ADD COLUMN "kind"               "EquipmentKind" NOT NULL DEFAULT 'OTHER',
  ADD COLUMN "baseVehicle"        TEXT,
  -- B. Technical
  ADD COLUMN "weightTons"       DOUBLE PRECISION,
  ADD COLUMN "heightMeters"     DOUBLE PRECISION,
  ADD COLUMN "enginePower"      INTEGER,
  ADD COLUMN "maxPileLength"    DOUBLE PRECISION,
  ADD COLUMN "maxPileDiameter"  INTEGER,
  ADD COLUMN "maxDrillingDepth" DOUBLE PRECISION,
  ADD COLUMN "hammerType"       TEXT,
  ADD COLUMN "hammerEnergyKj"   DOUBLE PRECISION,
  -- C. Operation
  ADD COLUMN "purchaseDate"           TIMESTAMPTZ(3),
  ADD COLUMN "purchasePrice"          DECIMAL(14, 2),
  ADD COLUMN "engineHoursTotal"       INTEGER,
  ADD COLUMN "nextMaintenanceAtHours" INTEGER,
  ADD COLUMN "nextMaintenanceDate"    TIMESTAMPTZ(3),
  ADD COLUMN "homeBaseLocation"       TEXT;

CREATE INDEX "Equipment_kind_idx"            ON "Equipment"("kind");
CREATE INDEX "Equipment_inventoryNumber_idx" ON "Equipment"("inventoryNumber");

-- ============================================================
-- 3. Backfill what we know about the existing fleet
-- ============================================================
-- Liebherr LRH 100 — Liebherr's leader rig, hybrid (impact piling + auger drilling).
UPDATE "Equipment"
   SET "kind" = 'HYBRID'
 WHERE "id" IN ('eq-lrh-100-1', 'eq-lrh-100-2');

-- PVE 50PR — vibratory pile hammer.
UPDATE "Equipment"
   SET "kind"       = 'VIBRO_HAMMER',
       "hammerType" = 'PVE 50PR'
 WHERE "id" = 'eq-pve-50pr';

-- КБУРГ-16.02 №1 — Russian auger rig mounted on Volvo EC360BLC.
UPDATE "Equipment"
   SET "kind"        = 'DRILLING_RIG',
       "baseVehicle" = 'Volvo EC360BLC'
 WHERE "id" = 'eq-kburg-1602-1';

-- КБУРГ-16.02 №2 — same family, mounted on ЕК 400 excavator.
UPDATE "Equipment"
   SET "kind"        = 'DRILLING_RIG',
       "baseVehicle" = 'ЕК 400'
 WHERE "id" = 'eq-kburg-1602-2';

-- Kopernik-SD-20 (JinTai SD-20A) — Chinese rotary drilling rig.
UPDATE "Equipment"
   SET "kind" = 'DRILLING_RIG'
 WHERE "id" = 'eq-kopernik-sd20';

-- Banut 655 + Junttan HHK-5/7 hydraulic impact hammer.
UPDATE "Equipment"
   SET "kind"       = 'PILE_DRIVER',
       "hammerType" = 'Junttan HHK-5/7'
 WHERE "name" ILIKE '%Banut 655%';

-- ============================================================
-- 4. EquipmentDocument
-- ============================================================
CREATE TABLE "EquipmentDocument" (
  "id"          TEXT NOT NULL,
  "tenantId"    TEXT NOT NULL,
  "equipmentId" TEXT NOT NULL,
  "type"        "EquipmentDocumentType" NOT NULL,
  "title"       TEXT NOT NULL,
  "issuedAt"    TIMESTAMPTZ(3),
  "expiresAt"   TIMESTAMPTZ(3),
  "mediaId"     TEXT,
  "notes"       TEXT NOT NULL DEFAULT '',
  "createdAt"   TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "EquipmentDocument_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EquipmentDocument_tenantId_idx"    ON "EquipmentDocument"("tenantId");
CREATE INDEX "EquipmentDocument_equipmentId_idx" ON "EquipmentDocument"("equipmentId");
CREATE INDEX "EquipmentDocument_type_idx"        ON "EquipmentDocument"("type");
CREATE INDEX "EquipmentDocument_expiresAt_idx"   ON "EquipmentDocument"("expiresAt");

ALTER TABLE "EquipmentDocument"
  ADD CONSTRAINT "EquipmentDocument_equipmentId_fkey"
    FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE CASCADE;
