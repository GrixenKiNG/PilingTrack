-- Align constraint and index names with Prisma's naming convention.
-- Names only: no table, column, key or index is added or removed here.
-- Without this every generated migration keeps re-proposing the same renames.

ALTER TABLE "CurrentReadiness" RENAME CONSTRAINT "CurrentReadiness_snapshot_fkey" TO "CurrentReadiness_tenantId_snapshotId_fkey";
ALTER TABLE "OperatorChecklistAnswerRecord" RENAME CONSTRAINT "OperatorChecklistAnswerRecord_answeredBy_fkey" TO "OperatorChecklistAnswerRecord_tenantId_answeredById_fkey";
ALTER TABLE "OperatorChecklistAnswerRecord" RENAME CONSTRAINT "OperatorChecklistAnswerRecord_execution_fkey" TO "OperatorChecklistAnswerRecord_tenantId_executionId_fkey";
ALTER TABLE "OperatorChecklistExecution" RENAME CONSTRAINT "OperatorChecklistExecution_equipment_fkey" TO "OperatorChecklistExecution_tenantId_equipmentId_fkey";
ALTER TABLE "OperatorChecklistExecution" RENAME CONSTRAINT "OperatorChecklistExecution_shift_fkey" TO "OperatorChecklistExecution_tenantId_shiftId_fkey";
ALTER TABLE "OperatorChecklistExecution" RENAME CONSTRAINT "OperatorChecklistExecution_startedBy_fkey" TO "OperatorChecklistExecution_tenantId_startedById_fkey";
ALTER TABLE "OperatorChecklistExecution" RENAME CONSTRAINT "OperatorChecklistExecution_template_fkey" TO "OperatorChecklistExecution_tenantId_templateId_fkey";
ALTER TABLE "OperatorChecklistTemplate" RENAME CONSTRAINT "OperatorChecklistTemplate_createdBy_fkey" TO "OperatorChecklistTemplate_tenantId_createdById_fkey";
ALTER TABLE "OperatorShiftEvidence" RENAME CONSTRAINT "OperatorShiftEvidence_equipment_fkey" TO "OperatorShiftEvidence_tenantId_equipmentId_fkey";
ALTER TABLE "OperatorShiftEvidence" RENAME CONSTRAINT "OperatorShiftEvidence_recordedBy_fkey" TO "OperatorShiftEvidence_tenantId_recordedById_fkey";
ALTER TABLE "OperatorShiftEvidence" RENAME CONSTRAINT "OperatorShiftEvidence_shift_fkey" TO "OperatorShiftEvidence_tenantId_shiftId_fkey";
ALTER TABLE "Shift" RENAME CONSTRAINT "Shift_canceller_tenant_fkey" TO "Shift_tenantId_cancelledById_fkey";
ALTER TABLE "Shift" RENAME CONSTRAINT "Shift_closer_tenant_fkey" TO "Shift_tenantId_closedById_fkey";
ALTER TABLE "Shift" RENAME CONSTRAINT "Shift_creator_tenant_fkey" TO "Shift_tenantId_createdById_fkey";
ALTER TABLE "Shift" RENAME CONSTRAINT "Shift_editor_tenant_fkey" TO "Shift_tenantId_lastEditedById_fkey";
ALTER TABLE "Shift" RENAME CONSTRAINT "Shift_equipment_tenant_fkey" TO "Shift_tenantId_equipmentId_fkey";
ALTER TABLE "Shift" RENAME CONSTRAINT "Shift_startSnapshot_fkey" TO "Shift_tenantId_startSnapshotId_fkey";
ALTER TABLE "Shift" RENAME CONSTRAINT "Shift_starter_tenant_fkey" TO "Shift_tenantId_startedById_fkey";
ALTER TABLE "ShiftHandover" RENAME CONSTRAINT "ShiftHandover_acceptor_tenant_fkey" TO "ShiftHandover_tenantId_acceptedById_fkey";
ALTER TABLE "ShiftHandover" RENAME CONSTRAINT "ShiftHandover_reworker_tenant_fkey" TO "ShiftHandover_tenantId_reworkedById_fkey";
ALTER TABLE "ShiftHandover" RENAME CONSTRAINT "ShiftHandover_shift_tenant_fkey" TO "ShiftHandover_tenantId_shiftId_fkey";
ALTER TABLE "ShiftHandover" RENAME CONSTRAINT "ShiftHandover_submitter_tenant_fkey" TO "ShiftHandover_tenantId_submittedById_fkey";
ALTER TABLE "WorkPermit" RENAME CONSTRAINT "WorkPermit_author_tenant_fkey" TO "WorkPermit_tenantId_authorId_fkey";
ALTER TABLE "WorkPermit" RENAME CONSTRAINT "WorkPermit_editor_tenant_fkey" TO "WorkPermit_tenantId_lastEditedById_fkey";
ALTER TABLE "WorkPermit" RENAME CONSTRAINT "WorkPermit_equipment_tenant_fkey" TO "WorkPermit_tenantId_equipmentId_fkey";
ALTER TABLE "WorkPermit" RENAME CONSTRAINT "WorkPermit_revoker_tenant_fkey" TO "WorkPermit_tenantId_revokedById_fkey";
ALTER TABLE "WorkPermit" RENAME CONSTRAINT "WorkPermit_shift_tenant_fkey" TO "WorkPermit_tenantId_shiftId_fkey";
ALTER TABLE "WorkPermitApproval" RENAME CONSTRAINT "WorkPermitApproval_approver_tenant_fkey" TO "WorkPermitApproval_tenantId_approvedById_fkey";
ALTER TABLE "WorkPermitApproval" RENAME CONSTRAINT "WorkPermitApproval_permit_fkey" TO "WorkPermitApproval_tenantId_permitId_fkey";
ALTER INDEX "LeaderDrilling_corrects_idx" RENAME TO "LeaderDrilling_correctsId_idx";
ALTER INDEX "OfflineWorkAuthorizationRecord_tenantId_operatorId_deviceId_exp" RENAME TO "OfflineWorkAuthorizationRecord_tenantId_operatorId_deviceId_idx";
ALTER INDEX "OperatorChecklistAnswerRecord_tenantId_executionId_answeredAt_i" RENAME TO "OperatorChecklistAnswerRecord_tenantId_executionId_answered_idx";
ALTER INDEX "OperatorChecklistExecution_tenantId_shiftId_status_startedAt_id" RENAME TO "OperatorChecklistExecution_tenantId_shiftId_status_startedA_idx";
ALTER INDEX "PileWork_corrects_idx" RENAME TO "PileWork_correctsId_idx";
ALTER INDEX "ReadinessScoreSnapshot_tenantId_equipmentId_triggerType_trigger" RENAME TO "ReadinessScoreSnapshot_tenantId_equipmentId_triggerType_tri_key";
ALTER INDEX "ReportDowntime_corrects_idx" RENAME TO "ReportDowntime_correctsId_idx";
ALTER INDEX "SafetyIncident_tenant_open_idx" RENAME TO "SafetyIncident_tenantId_reviewedAt_occurredAt_idx";
