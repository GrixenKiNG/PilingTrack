-- CreateEnum
CREATE TYPE "ChecklistLevel" AS ENUM ('EO', 'TO1', 'TO2', 'TO3', 'SEASONAL');

-- CreateEnum
CREATE TYPE "AnswerType" AS ENUM ('YES_NO', 'STATUS4', 'DONE', 'MEASURE');

-- CreateEnum
CREATE TYPE "InspectionStatus" AS ENUM ('DRAFT', 'COMPLETED');

-- CreateTable
CREATE TABLE "ChecklistTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" "ChecklistLevel" NOT NULL,
    "appliesToModel" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ChecklistTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistSection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "ChecklistSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "answerType" "AnswerType" NOT NULL DEFAULT 'YES_NO',
    "unit" TEXT,
    "norm" TEXT,
    "provenance" TEXT,
    "photoRequired" BOOLEAN NOT NULL DEFAULT false,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL,

    CONSTRAINT "ChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inspection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "level" "ChecklistLevel" NOT NULL,
    "performedById" TEXT NOT NULL,
    "shift" TEXT,
    "inspectionDate" TIMESTAMPTZ(3) NOT NULL,
    "engineHours" INTEGER,
    "healthScore" INTEGER,
    "status" "InspectionStatus" NOT NULL DEFAULT 'DRAFT',
    "templateSnapshot" JSONB NOT NULL,
    "signedByName" TEXT,
    "signedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Inspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InspectionAnswer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "value" TEXT,
    "note" TEXT,
    "photoCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InspectionAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChecklistTemplate_tenantId_idx" ON "ChecklistTemplate"("tenantId");

-- CreateIndex
CREATE INDEX "ChecklistTemplate_tenantId_level_idx" ON "ChecklistTemplate"("tenantId", "level");

-- CreateIndex
CREATE INDEX "ChecklistSection_tenantId_idx" ON "ChecklistSection"("tenantId");

-- CreateIndex
CREATE INDEX "ChecklistSection_templateId_idx" ON "ChecklistSection"("templateId");

-- CreateIndex
CREATE INDEX "ChecklistItem_tenantId_idx" ON "ChecklistItem"("tenantId");

-- CreateIndex
CREATE INDEX "ChecklistItem_sectionId_idx" ON "ChecklistItem"("sectionId");

-- CreateIndex
CREATE INDEX "Inspection_tenantId_idx" ON "Inspection"("tenantId");

-- CreateIndex
CREATE INDEX "Inspection_tenantId_equipmentId_idx" ON "Inspection"("tenantId", "equipmentId");

-- CreateIndex
CREATE INDEX "Inspection_tenantId_status_idx" ON "Inspection"("tenantId", "status");

-- CreateIndex
CREATE INDEX "InspectionAnswer_tenantId_idx" ON "InspectionAnswer"("tenantId");

-- CreateIndex
CREATE INDEX "InspectionAnswer_inspectionId_idx" ON "InspectionAnswer"("inspectionId");

-- AddForeignKey
ALTER TABLE "ChecklistSection" ADD CONSTRAINT "ChecklistSection_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ChecklistTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistItem" ADD CONSTRAINT "ChecklistItem_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "ChecklistSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "Equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inspection" ADD CONSTRAINT "Inspection_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ChecklistTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionAnswer" ADD CONSTRAINT "InspectionAnswer_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "Inspection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
