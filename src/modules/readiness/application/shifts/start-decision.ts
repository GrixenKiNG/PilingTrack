import {createHash, randomUUID} from 'node:crypto';
import type {Prisma} from '@/generated/postgres-client/client';
import {computeReadinessScore, type ReadinessFacts} from '../../domain/readiness-score';
import {DEFAULT_READINESS_RULES, sanitizeRuleSet} from '../../domain/readiness-rules';
import type {ReadinessTransaction} from '../../infrastructure/tenant-transaction';
import {tenantProductionDate} from '../../domain/shifts/tenant-production-date';

const OPEN_MAINTENANCE = ['PLANNED', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'] as const;

export async function evaluateAuthoritativeShiftStart(input: {
  tx: ReadinessTransaction;
  tenantId: string;
  equipmentId: string;
  shiftId: string;
  now: Date;
  timezone: string;
}) {
  const [equipment, inspection, openRecords, permit, publishedRow] = await Promise.all([
    input.tx.equipment.findFirst({where: {tenantId: input.tenantId, id: input.equipmentId, isActive: true},
      select: {id: true, engineHoursTotal: true, nextMaintenanceAtHours: true, nextMaintenanceDate: true}}),
    input.tx.inspection.findFirst({where: {tenantId: input.tenantId, equipmentId: input.equipmentId,
      status: 'COMPLETED'}, orderBy: {inspectionDate: 'desc'}, select: {id: true, inspectionDate: true, healthScore: true}}),
    input.tx.maintenanceRecord.findMany({where: {tenantId: input.tenantId, equipmentId: input.equipmentId,
      status: {in: [...OPEN_MAINTENANCE]}}, select: {id: true, type: true, priority: true, scheduledAt: true}}),
    input.tx.workPermit.findFirst({where: {tenantId: input.tenantId, equipmentId: input.equipmentId,
      state: 'APPROVED', validFrom: {lte: input.now}, validTo: {gt: input.now},
      OR: [{shiftId: null}, {shiftId: input.shiftId}]}, orderBy: {approvedAt: 'desc'}, select: {id: true, validTo: true}}),
    input.tx.readinessRuleSet.findFirst({where: {tenantId: input.tenantId, status: 'PUBLISHED'}, orderBy: {updatedAt: 'desc'}}),
  ]);
  if (!equipment) throw new Error('Authoritative equipment row is unavailable');

  const inspectionSameUtcDay = inspection
    ? tenantProductionDate(inspection.inspectionDate, input.timezone).getTime()
      === tenantProductionDate(input.now, input.timezone).getTime()
    : false;
  const maintenanceOverdueHours = equipment.nextMaintenanceAtHours != null && equipment.engineHoursTotal != null
    ? Math.max(0, equipment.engineHoursTotal - equipment.nextMaintenanceAtHours) : 0;
  const maintenanceOverdueDays = equipment.nextMaintenanceDate && equipment.nextMaintenanceDate < input.now
    ? Math.ceil((input.now.getTime() - equipment.nextMaintenanceDate.getTime()) / 86_400_000) : 0;
  const criticalDefect = openRecords.some((record) =>
    (record.type === 'FAULT' || record.type === 'REPAIR') && record.priority === 'CRITICAL');
  const healthScore = inspection?.healthScore ?? null;
  const facts: ReadinessFacts = {
    inspectionCompleted: inspectionSameUtcDay,
    inspectionProgress: inspectionSameUtcDay ? 1 : inspection ? 0.5 : 0,
    healthScore,
    meterKnown: equipment.engineHoursTotal != null,
    permitValid: Boolean(permit),
    permitExpired: false,
    maintenanceConfigured: equipment.nextMaintenanceAtHours != null || equipment.nextMaintenanceDate != null,
    maintenanceOverdueHours,
    maintenanceOverdueDays,
    accepted: false,
    criticalDefect,
    findings: healthScore == null ? 0 : Math.max(0, Math.ceil((100 - healthScore) / 10)),
  };
  const rules = publishedRow ? sanitizeRuleSet({
    version: publishedRow.version, status: publishedRow.status, criteria: publishedRow.criteria,
    blockers: publishedRow.blockers, updatedAt: publishedRow.updatedAt.toISOString(),
    updatedBy: publishedRow.updatedBy ?? undefined, publishedAt: publishedRow.publishedAt?.toISOString() ?? null,
  }, DEFAULT_READINESS_RULES) : DEFAULT_READINESS_RULES;
  const result = computeReadinessScore(facts, rules);
  const warnings = !permit && !rules.blockers.some((item) =>
    item.condition === 'VALID_WORK_PERMIT_REQUIRED' && item.isActive)
    ? [{code: 'WORK_PERMIT_MISSING_OPTIONAL', message: 'Valid work permit is not required by published rules'}]
    : [];
  const evidence = {equipmentId: equipment.id, inspectionId: inspection?.id ?? null,
    permitId: permit?.id ?? null, maintenanceRecordIds: openRecords.map((item) => item.id),
    evaluatedAt: input.now.toISOString()};
  const factsHash = createHash('sha256').update(JSON.stringify({facts, evidence})).digest();
  const triggerId = `${input.shiftId}:v1:${input.now.toISOString()}:${randomUUID()}`;
  const snapshot = await input.tx.readinessScoreSnapshot.create({data: {
    id: randomUUID(), tenantId: input.tenantId, equipmentId: input.equipmentId, shiftId: input.shiftId,
    ruleSetId: publishedRow?.id ?? 'default-readiness-rules', ruleSetVersion: rules.version,
    triggerType: 'SHIFT_START_DECISION', triggerId, status: result.canStart ? 'READY' : 'BLOCKED',
    score: result.score, blockers: result.blockers as unknown as Prisma.InputJsonValue,
    warnings: warnings as Prisma.InputJsonValue, evidence: evidence as Prisma.InputJsonValue, factsHash,
    calculatedAt: input.now,
  }});
  return {allowed: result.canStart, score: result.score, blockers: result.blockers, warnings,
    snapshotId: snapshot.id, ruleSetId: snapshot.ruleSetId, ruleSetVersion: snapshot.ruleSetVersion, evidence};
}
