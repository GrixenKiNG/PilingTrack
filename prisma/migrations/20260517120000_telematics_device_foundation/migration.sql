-- Telematics foundation.
--
-- Extends Equipment with optional identification fields.
-- Creates TelematicsDevice + TelematicsDeviceAssignment for telemetry
-- endpoint metadata and append-only swap history.
-- Adds telematicsDeviceId to DeviceKey to link PUSH-mode auth keys
-- back to their physical device.
--
-- Schema only; no app code uses these yet. Encrypted-secret storage,
-- the PULL poller worker, and OEM API connectors come in separate
-- migrations once the corresponding hardware/integration arrives.

-- ============================================================
-- 1. Enums
-- ============================================================
CREATE TYPE "TelematicsProvider" AS ENUM (
  'TELTONIKA_FMC640',
  'TELTONIKA_FMB640',
  'GALILEOSKY_7X',
  'WIALON_GENERIC',
  'OTHER'
);

CREATE TYPE "TelematicsAuthType" AS ENUM (
  'PUSH_TOKEN',
  'API_KEY',
  'OAUTH2',
  'IP_ALLOWLIST',
  'NONE'
);

CREATE TYPE "TelematicsStatus" AS ENUM (
  'PROVISIONED',
  'ACTIVE',
  'DEGRADED',
  'OFFLINE',
  'ARCHIVED'
);

-- ============================================================
-- 2. Equipment — extended identification
-- ============================================================
ALTER TABLE "Equipment"
  ADD COLUMN "serialNumber"    TEXT,
  ADD COLUMN "manufactureYear" INTEGER,
  ADD COLUMN "vin"             TEXT;

-- Backfill manufacture years for the existing 7 rigs.
UPDATE "Equipment" SET "manufactureYear" = 2013 WHERE "id" = 'eq-lrh-100-1';
UPDATE "Equipment" SET "manufactureYear" = 2009 WHERE "id" = 'eq-lrh-100-2';
UPDATE "Equipment" SET "manufactureYear" = 2014 WHERE "id" = 'eq-pve-50pr';
UPDATE "Equipment" SET "manufactureYear" = 2007 WHERE "id" = 'eq-kburg-1602-1';
UPDATE "Equipment" SET "manufactureYear" = 2017 WHERE "id" = 'eq-kburg-1602-2';
UPDATE "Equipment" SET "manufactureYear" = 2013 WHERE "id" = 'eq-kopernik-sd20';
UPDATE "Equipment"
  SET "manufactureYear" = 2011
  WHERE "name" ILIKE '%Banut 655%';

-- ============================================================
-- 3. TelematicsDevice
-- ============================================================
CREATE TABLE "TelematicsDevice" (
  "id"              TEXT NOT NULL,
  "tenantId"        TEXT NOT NULL,
  "provider"        "TelematicsProvider" NOT NULL,
  "model"           TEXT,
  "firmwareVersion" TEXT,
  "imei"            TEXT,
  "serialNumber"    TEXT,
  "oemAccountId"    TEXT,
  "authType"        "TelematicsAuthType" NOT NULL,
  "endpointUrl"     TEXT,
  "pollIntervalSec" INTEGER,
  "lastPolledAt"    TIMESTAMPTZ(3),
  "nextPollAt"      TIMESTAMPTZ(3),
  "equipmentId"     TEXT,
  "installedAt"     TIMESTAMPTZ(3),
  "status"          "TelematicsStatus" NOT NULL DEFAULT 'PROVISIONED',
  "lastSeenAt"      TIMESTAMPTZ(3),
  "lastError"       TEXT,
  "label"           TEXT NOT NULL,
  "notes"           TEXT NOT NULL DEFAULT '',
  "createdAt"       TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "TelematicsDevice_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TelematicsDevice_tenantId_idx"     ON "TelematicsDevice"("tenantId");
CREATE INDEX "TelematicsDevice_equipmentId_idx"  ON "TelematicsDevice"("equipmentId");
CREATE INDEX "TelematicsDevice_provider_idx"     ON "TelematicsDevice"("provider");
CREATE INDEX "TelematicsDevice_status_idx"       ON "TelematicsDevice"("status");
CREATE INDEX "TelematicsDevice_nextPollAt_idx"   ON "TelematicsDevice"("nextPollAt");

-- IMEI globally unique within a hardware provider (catches duplicate provisioning).
CREATE UNIQUE INDEX "uq_telematics_provider_imei"
  ON "TelematicsDevice"("provider", "imei")
  WHERE "imei" IS NOT NULL;

ALTER TABLE "TelematicsDevice"
  ADD CONSTRAINT "TelematicsDevice_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "TelematicsDevice_equipmentId_fkey"
    FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE SET NULL;

-- ============================================================
-- 4. TelematicsDeviceAssignment (append-only)
-- ============================================================
CREATE TABLE "TelematicsDeviceAssignment" (
  "id"          TEXT NOT NULL,
  "tenantId"    TEXT NOT NULL,
  "deviceId"    TEXT NOT NULL,
  "equipmentId" TEXT NOT NULL,
  "startedAt"   TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt"     TIMESTAMPTZ(3),
  "reason"      TEXT,

  CONSTRAINT "TelematicsDeviceAssignment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TelematicsDeviceAssignment_deviceId_startedAt_idx"
  ON "TelematicsDeviceAssignment"("deviceId", "startedAt");
CREATE INDEX "TelematicsDeviceAssignment_equipmentId_startedAt_idx"
  ON "TelematicsDeviceAssignment"("equipmentId", "startedAt");
CREATE INDEX "TelematicsDeviceAssignment_tenantId_idx"
  ON "TelematicsDeviceAssignment"("tenantId");

ALTER TABLE "TelematicsDeviceAssignment"
  ADD CONSTRAINT "TelematicsDeviceAssignment_deviceId_fkey"
    FOREIGN KEY ("deviceId") REFERENCES "TelematicsDevice"("id") ON DELETE CASCADE,
  ADD CONSTRAINT "TelematicsDeviceAssignment_equipmentId_fkey"
    FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE CASCADE;

-- ============================================================
-- 5. DeviceKey — link to TelematicsDevice
-- ============================================================
ALTER TABLE "DeviceKey"
  ADD COLUMN "telematicsDeviceId" TEXT;

CREATE INDEX "DeviceKey_telematicsDeviceId_idx"
  ON "DeviceKey"("telematicsDeviceId");

ALTER TABLE "DeviceKey"
  ADD CONSTRAINT "DeviceKey_telematicsDeviceId_fkey"
    FOREIGN KEY ("telematicsDeviceId") REFERENCES "TelematicsDevice"("id") ON DELETE SET NULL;
