CREATE TYPE "OperatorEvidenceKind" AS ENUM (
  'KNOWLEDGE_TEST', 'WEATHER_SNAPSHOT', 'SITE_CHECK', 'STARTUP_READING',
  'MAINTENANCE_ACTION', 'FLUID_READING', 'PILE_DRIVING', 'LEADER_DRILLING'
);

CREATE TABLE "OperatorChecklistTemplate" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "templateKey" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "stage" TEXT NOT NULL,
  "equipmentModel" TEXT NOT NULL,
  "technology" TEXT,
  "definition" JSONB NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OperatorChecklistTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OperatorChecklistExecution" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "shiftId" TEXT NOT NULL,
  "equipmentId" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "clientCommandId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
  "templateSnapshot" JSONB NOT NULL,
  "startedById" TEXT NOT NULL,
  "startedAt" TIMESTAMPTZ(3) NOT NULL,
  "completedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OperatorChecklistExecution_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OperatorChecklistAnswerRecord" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "executionId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "clientCommandId" TEXT NOT NULL,
  "result" TEXT NOT NULL,
  "value" JSONB,
  "note" TEXT,
  "mediaIds" JSONB NOT NULL DEFAULT '[]',
  "itemSnapshot" JSONB NOT NULL,
  "answeredAt" TIMESTAMPTZ(3) NOT NULL,
  "answeredById" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OperatorChecklistAnswerRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OperatorShiftEvidence" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "shiftId" TEXT NOT NULL,
  "equipmentId" TEXT NOT NULL,
  "kind" "OperatorEvidenceKind" NOT NULL,
  "payload" JSONB NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL,
  "recordedById" TEXT NOT NULL,
  "clientCommandId" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OperatorShiftEvidence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OperatorChecklistTemplate_tenantId_id_key" ON "OperatorChecklistTemplate"("tenantId", "id");
CREATE UNIQUE INDEX "OperatorChecklistTemplate_tenantId_templateKey_version_key" ON "OperatorChecklistTemplate"("tenantId", "templateKey", "version");
CREATE INDEX "OperatorChecklistTemplate_tenantId_stage_equipmentModel_idx" ON "OperatorChecklistTemplate"("tenantId", "stage", "equipmentModel");
CREATE UNIQUE INDEX "OperatorChecklistExecution_tenantId_id_key" ON "OperatorChecklistExecution"("tenantId", "id");
CREATE UNIQUE INDEX "OperatorChecklistExecution_tenantId_clientCommandId_key" ON "OperatorChecklistExecution"("tenantId", "clientCommandId");
CREATE INDEX "OperatorChecklistExecution_tenantId_shiftId_status_startedAt_idx" ON "OperatorChecklistExecution"("tenantId", "shiftId", "status", "startedAt");
CREATE INDEX "OperatorChecklistExecution_tenantId_equipmentId_startedAt_idx" ON "OperatorChecklistExecution"("tenantId", "equipmentId", "startedAt");
CREATE UNIQUE INDEX "OperatorChecklistAnswerRecord_tenantId_id_key" ON "OperatorChecklistAnswerRecord"("tenantId", "id");
CREATE UNIQUE INDEX "OperatorChecklistAnswerRecord_tenantId_clientCommandId_key" ON "OperatorChecklistAnswerRecord"("tenantId", "clientCommandId");
CREATE UNIQUE INDEX "OperatorChecklistAnswerRecord_tenantId_executionId_itemId_key" ON "OperatorChecklistAnswerRecord"("tenantId", "executionId", "itemId");
CREATE INDEX "OperatorChecklistAnswerRecord_tenantId_executionId_answeredAt_idx" ON "OperatorChecklistAnswerRecord"("tenantId", "executionId", "answeredAt");
CREATE UNIQUE INDEX "OperatorShiftEvidence_tenantId_id_key" ON "OperatorShiftEvidence"("tenantId", "id");
CREATE UNIQUE INDEX "OperatorShiftEvidence_tenantId_clientCommandId_key" ON "OperatorShiftEvidence"("tenantId", "clientCommandId");
CREATE INDEX "OperatorShiftEvidence_tenantId_shiftId_kind_occurredAt_idx" ON "OperatorShiftEvidence"("tenantId", "shiftId", "kind", "occurredAt");
CREATE INDEX "OperatorShiftEvidence_tenantId_equipmentId_kind_occurredAt_idx" ON "OperatorShiftEvidence"("tenantId", "equipmentId", "kind", "occurredAt");

ALTER TABLE "OperatorChecklistTemplate"
  ADD CONSTRAINT "OperatorChecklistTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OperatorChecklistTemplate_createdBy_fkey" FOREIGN KEY ("tenantId", "createdById") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OperatorChecklistExecution"
  ADD CONSTRAINT "OperatorChecklistExecution_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OperatorChecklistExecution_shift_fkey" FOREIGN KEY ("tenantId", "shiftId") REFERENCES "Shift"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OperatorChecklistExecution_equipment_fkey" FOREIGN KEY ("tenantId", "equipmentId") REFERENCES "Equipment"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OperatorChecklistExecution_template_fkey" FOREIGN KEY ("tenantId", "templateId") REFERENCES "OperatorChecklistTemplate"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OperatorChecklistExecution_startedBy_fkey" FOREIGN KEY ("tenantId", "startedById") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OperatorChecklistAnswerRecord"
  ADD CONSTRAINT "OperatorChecklistAnswerRecord_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OperatorChecklistAnswerRecord_execution_fkey" FOREIGN KEY ("tenantId", "executionId") REFERENCES "OperatorChecklistExecution"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OperatorChecklistAnswerRecord_answeredBy_fkey" FOREIGN KEY ("tenantId", "answeredById") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OperatorShiftEvidence"
  ADD CONSTRAINT "OperatorShiftEvidence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OperatorShiftEvidence_shift_fkey" FOREIGN KEY ("tenantId", "shiftId") REFERENCES "Shift"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OperatorShiftEvidence_equipment_fkey" FOREIGN KEY ("tenantId", "equipmentId") REFERENCES "Equipment"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "OperatorShiftEvidence_recordedBy_fkey" FOREIGN KEY ("tenantId", "recordedById") REFERENCES "User"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_operator_checklist_answer_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Ответ operator-v3 неизменяем; создайте новую запись выполнения';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "OperatorChecklistAnswerRecord_immutable"
BEFORE UPDATE OR DELETE ON "OperatorChecklistAnswerRecord"
FOR EACH ROW EXECUTE FUNCTION prevent_operator_checklist_answer_mutation();

ALTER TABLE "OperatorChecklistTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OperatorChecklistTemplate" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_operator_checklist_template" ON "OperatorChecklistTemplate" FOR ALL USING ("tenantId" = current_setting('app.current_tenant', true));
ALTER TABLE "OperatorChecklistExecution" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OperatorChecklistExecution" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_operator_checklist_execution" ON "OperatorChecklistExecution" FOR ALL USING ("tenantId" = current_setting('app.current_tenant', true));
ALTER TABLE "OperatorChecklistAnswerRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OperatorChecklistAnswerRecord" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_operator_checklist_answer" ON "OperatorChecklistAnswerRecord" FOR ALL USING ("tenantId" = current_setting('app.current_tenant', true));
ALTER TABLE "OperatorShiftEvidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OperatorShiftEvidence" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation_operator_shift_evidence" ON "OperatorShiftEvidence" FOR ALL USING ("tenantId" = current_setting('app.current_tenant', true));
