CREATE TYPE "WorkPermitRisk" AS ENUM ('NORMAL', 'ELEVATED');
CREATE TYPE "WorkPermitState" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'EXPIRED', 'REVOKED');
CREATE TYPE "WorkPermitApprovalRole" AS ENUM ('DISPATCHER', 'ADMIN');

CREATE TABLE "WorkPermit" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "equipmentId" TEXT NOT NULL,
  "shiftId" TEXT,
  "risk" "WorkPermitRisk" NOT NULL,
  "state" "WorkPermitState" NOT NULL DEFAULT 'DRAFT',
  "scope" TEXT NOT NULL,
  "validFrom" TIMESTAMPTZ(3) NOT NULL,
  "validTo" TIMESTAMPTZ(3) NOT NULL,
  "timezone" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "lastEditedById" TEXT NOT NULL,
  "submittedAt" TIMESTAMPTZ(3),
  "approvedAt" TIMESTAMPTZ(3),
  "revokedAt" TIMESTAMPTZ(3),
  "revokedById" TEXT,
  "revokeReason" TEXT,
  "expiredAt" TIMESTAMPTZ(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "WorkPermit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkPermit_valid_window" CHECK ("validTo" > "validFrom"),
  CONSTRAINT "WorkPermit_version_positive" CHECK ("version" > 0),
  CONSTRAINT "WorkPermit_shift_not_available_yet" CHECK ("shiftId" IS NULL),
  CONSTRAINT "WorkPermit_tenantId_fkey" FOREIGN KEY ("tenantId")
    REFERENCES "Tenant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "WorkPermit_equipment_tenant_fkey" FOREIGN KEY ("tenantId", "equipmentId")
    REFERENCES "Equipment" ("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "WorkPermit_author_tenant_fkey" FOREIGN KEY ("tenantId", "authorId")
    REFERENCES "User" ("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "WorkPermit_editor_tenant_fkey" FOREIGN KEY ("tenantId", "lastEditedById")
    REFERENCES "User" ("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "WorkPermit_revoker_tenant_fkey" FOREIGN KEY ("tenantId", "revokedById")
    REFERENCES "User" ("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- The composite parent key must exist before WorkPermitApproval declares its
-- tenant-safe foreign key on (tenantId, permitId).
CREATE UNIQUE INDEX "WorkPermit_tenantId_id_key" ON "WorkPermit" ("tenantId", "id");

CREATE TABLE "WorkPermitApproval" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "permitId" TEXT NOT NULL,
  "permitVersion" INTEGER NOT NULL,
  "role" "WorkPermitApprovalRole" NOT NULL,
  "approvedById" TEXT NOT NULL,
  "approvedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "valid" BOOLEAN NOT NULL DEFAULT true,
  "invalidatedAt" TIMESTAMPTZ(3),
  "invalidationReason" TEXT,
  CONSTRAINT "WorkPermitApproval_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkPermitApproval_permit_fkey" FOREIGN KEY ("tenantId", "permitId")
    REFERENCES "WorkPermit" ("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "WorkPermitApproval_approver_tenant_fkey" FOREIGN KEY ("tenantId", "approvedById")
    REFERENCES "User" ("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "WorkPermit_tenantId_equipmentId_state_validTo_idx" ON "WorkPermit" ("tenantId", "equipmentId", "state", "validTo");
CREATE INDEX "WorkPermit_tenantId_state_updatedAt_idx" ON "WorkPermit" ("tenantId", "state", "updatedAt");
CREATE INDEX "WorkPermit_tenantId_risk_updatedAt_idx" ON "WorkPermit" ("tenantId", "risk", "updatedAt");
CREATE INDEX "WorkPermit_tenantId_shiftId_idx" ON "WorkPermit" ("tenantId", "shiftId");
CREATE UNIQUE INDEX "WorkPermitApproval_tenantId_permitId_permitVersion_role_key"
  ON "WorkPermitApproval" ("tenantId", "permitId", "permitVersion", "role");
CREATE INDEX "WorkPermitApproval_tenantId_permitId_permitVersion_valid_idx"
  ON "WorkPermitApproval" ("tenantId", "permitId", "permitVersion", "valid");
CREATE INDEX "WorkPermitApproval_tenantId_approvedById_approvedAt_idx"
  ON "WorkPermitApproval" ("tenantId", "approvedById", "approvedAt");
