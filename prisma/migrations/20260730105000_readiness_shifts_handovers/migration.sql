CREATE TYPE "ShiftType" AS ENUM ('DAY', 'NIGHT');
CREATE TYPE "ShiftState" AS ENUM ('PLANNED', 'STARTED', 'HANDOVER_PENDING', 'CLOSED', 'CANCELLED');
CREATE TYPE "ShiftHandoverState" AS ENUM ('DRAFT', 'SUBMITTED', 'REWORK_REQUIRED', 'ACCEPTED');

CREATE TABLE "Shift" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "equipmentId" TEXT NOT NULL,
  "type" "ShiftType" NOT NULL,
  "state" "ShiftState" NOT NULL DEFAULT 'PLANNED',
  "productionDate" DATE NOT NULL,
  "timezone" TEXT NOT NULL,
  "plannedStartAt" TIMESTAMPTZ(3),
  "plannedEndAt" TIMESTAMPTZ(3),
  "createdById" TEXT NOT NULL,
  "lastEditedById" TEXT NOT NULL,
  "startedAt" TIMESTAMPTZ(3),
  "startedById" TEXT,
  "closedAt" TIMESTAMPTZ(3),
  "closedById" TEXT,
  "cancelledAt" TIMESTAMPTZ(3),
  "cancelledById" TEXT,
  "cancelReason" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "Shift_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Shift_version_positive" CHECK ("version" > 0),
  CONSTRAINT "Shift_planned_window" CHECK ("plannedEndAt" IS NULL OR "plannedStartAt" IS NULL OR "plannedEndAt" > "plannedStartAt"),
  CONSTRAINT "Shift_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Shift_equipment_tenant_fkey" FOREIGN KEY ("tenantId", "equipmentId") REFERENCES "Equipment"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Shift_creator_tenant_fkey" FOREIGN KEY ("tenantId", "createdById") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Shift_editor_tenant_fkey" FOREIGN KEY ("tenantId", "lastEditedById") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Shift_starter_tenant_fkey" FOREIGN KEY ("tenantId", "startedById") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Shift_closer_tenant_fkey" FOREIGN KEY ("tenantId", "closedById") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Shift_canceller_tenant_fkey" FOREIGN KEY ("tenantId", "cancelledById") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Shift_tenantId_id_key" ON "Shift"("tenantId", "id");
CREATE UNIQUE INDEX "Shift_one_active_per_equipment_key" ON "Shift"("tenantId", "equipmentId")
  WHERE "state" IN ('STARTED', 'HANDOVER_PENDING');
CREATE INDEX "Shift_tenantId_equipmentId_productionDate_idx" ON "Shift"("tenantId", "equipmentId", "productionDate");
CREATE INDEX "Shift_tenantId_state_updatedAt_idx" ON "Shift"("tenantId", "state", "updatedAt");

ALTER TABLE "WorkPermit" DROP CONSTRAINT "WorkPermit_shift_not_available_yet";
ALTER TABLE "WorkPermit" ADD CONSTRAINT "WorkPermit_shift_tenant_fkey"
  FOREIGN KEY ("tenantId", "shiftId") REFERENCES "Shift"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ShiftHandover" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "shiftId" TEXT NOT NULL,
  "state" "ShiftHandoverState" NOT NULL DEFAULT 'DRAFT',
  "summary" TEXT NOT NULL,
  "evidence" JSONB NOT NULL DEFAULT '{}',
  "submittedById" TEXT NOT NULL,
  "submittedAt" TIMESTAMPTZ(3),
  "acceptedById" TEXT,
  "acceptedAt" TIMESTAMPTZ(3),
  "reworkedById" TEXT,
  "reworkedAt" TIMESTAMPTZ(3),
  "reworkReason" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ShiftHandover_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ShiftHandover_version_positive" CHECK ("version" > 0),
  CONSTRAINT "ShiftHandover_shift_tenant_fkey" FOREIGN KEY ("tenantId", "shiftId") REFERENCES "Shift"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ShiftHandover_submitter_tenant_fkey" FOREIGN KEY ("tenantId", "submittedById") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ShiftHandover_acceptor_tenant_fkey" FOREIGN KEY ("tenantId", "acceptedById") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ShiftHandover_reworker_tenant_fkey" FOREIGN KEY ("tenantId", "reworkedById") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ShiftHandover_tenantId_id_key" ON "ShiftHandover"("tenantId", "id");
CREATE UNIQUE INDEX "ShiftHandover_one_live_per_shift_key" ON "ShiftHandover"("tenantId", "shiftId")
  WHERE "state" IN ('DRAFT', 'SUBMITTED', 'REWORK_REQUIRED');
CREATE INDEX "ShiftHandover_tenantId_shiftId_state_idx" ON "ShiftHandover"("tenantId", "shiftId", "state");
CREATE INDEX "ShiftHandover_tenantId_state_updatedAt_idx" ON "ShiftHandover"("tenantId", "state", "updatedAt");
