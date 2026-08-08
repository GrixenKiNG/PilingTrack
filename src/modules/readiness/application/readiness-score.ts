import type {Prisma} from '@/generated/postgres-client/client';
import type {ReadinessTransaction} from '../infrastructure/tenant-transaction';
import {tenantProductionDate} from '../domain/shifts/tenant-production-date';
import {capturedClock, type EvaluationClock} from '../domain/evaluation/clock';
import {evaluateReadiness} from '../domain/evaluation/evaluator';
import {immutablePublishedRules} from '../domain/evaluation/rules';

const OPEN_MAINTENANCE = ['PLANNED', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'] as const;

export async function evaluateAuthoritativeReadiness(input: {
  tx: ReadinessTransaction;
  tenantId: string;
  equipmentId: string;
  shiftId?: string | null;
  timezone: string;
  clock: EvaluationClock;
}) {
  const now = input.clock.now();
  const [
    equipment, inspection, openRecords, permit, publishedRow, acceptedHandover, blockingDefect,
  ] = await Promise.all([
    input.tx.equipment.findFirst({
      where: {tenantId: input.tenantId, id: input.equipmentId, isActive: true},
      select: {id: true, engineHoursTotal: true, nextMaintenanceAtHours: true, nextMaintenanceDate: true},
    }),
    input.tx.inspection.findFirst({
      where: {tenantId: input.tenantId, equipmentId: input.equipmentId, status: 'COMPLETED'},
      orderBy: {inspectionDate: 'desc'},
      select: {id: true, inspectionDate: true, healthScore: true},
    }),
    input.tx.maintenanceRecord.findMany({
      where: {tenantId: input.tenantId, equipmentId: input.equipmentId, status: {in: [...OPEN_MAINTENANCE]}},
      select: {id: true, type: true, priority: true},
    }),
    input.tx.workPermit.findFirst({
      where: {
        tenantId: input.tenantId, equipmentId: input.equipmentId, state: {in: ['APPROVED', 'EXPIRED']},
        validFrom: {lte: now},
        OR: input.shiftId ? [{shiftId: null}, {shiftId: input.shiftId}] : [{shiftId: null}],
      },
      orderBy: {validTo: 'desc'}, select: {id: true, state: true, validFrom: true, validTo: true},
    }),
    input.tx.readinessRuleSet.findFirst({
      where: {tenantId: input.tenantId, status: 'PUBLISHED'}, orderBy: {updatedAt: 'desc'},
    }),
    input.shiftId ? input.tx.shiftHandover.findFirst({
      where: {tenantId: input.tenantId, shiftId: input.shiftId, state: 'ACCEPTED'}, select: {id: true},
    }) : Promise.resolve(null),
    // Незакрытый критичный дефект из журнала. Без него запись в журнале
    // ничего не меняла бы в оценке: блокировка держалась только на нарядах
    // ремонта с приоритетом CRITICAL, а дефект — отдельная сущность.
    input.tx.equipmentDefect.findFirst({
      where: {
        tenantId: input.tenantId, equipmentId: input.equipmentId,
        severity: 'CRITICAL', status: {in: ['OPEN', 'IN_WORK']},
      },
      select: {id: true},
    }),
  ]);
  if (!equipment) throw new Error('Authoritative equipment row is unavailable');

  const inspectionSameTenantDay = inspection
    ? tenantProductionDate(inspection.inspectionDate, input.timezone).getTime()
      === tenantProductionDate(now, input.timezone).getTime()
    : false;
  const overdueHours = equipment.nextMaintenanceAtHours != null && equipment.engineHoursTotal != null
    ? Math.max(0, equipment.engineHoursTotal - equipment.nextMaintenanceAtHours) : 0;
  const overdueDays = equipment.nextMaintenanceDate && equipment.nextMaintenanceDate < now
    ? Math.ceil((now.getTime() - equipment.nextMaintenanceDate.getTime()) / 86_400_000) : 0;
  const healthScore = inspection?.healthScore ?? null;
  const facts = {
    inspectionCompleted: inspectionSameTenantDay,
    inspectionProgress: inspectionSameTenantDay ? 1 : inspection ? 0.5 : 0,
    healthScore,
    meterKnown: equipment.engineHoursTotal != null,
    permitValid: Boolean(permit && permit.state === 'APPROVED' && permit.validFrom <= now && permit.validTo > now),
    permitExpired: Boolean(permit && (permit.state === 'EXPIRED' || permit.validTo <= now)),
    maintenanceConfigured: equipment.nextMaintenanceAtHours != null || equipment.nextMaintenanceDate != null,
    maintenanceOverdueHours: overdueHours,
    maintenanceOverdueDays: overdueDays,
    accepted: Boolean(acceptedHandover),
    criticalDefect: blockingDefect != null || openRecords.some((row) =>
      (row.type === 'FAULT' || row.type === 'REPAIR') && row.priority === 'CRITICAL'),
    findings: healthScore == null ? 0 : Math.max(0, Math.ceil((100 - healthScore) / 10)),
  } as const;

  const rules = publishedRow ? immutablePublishedRules({
    version: publishedRow.version,
    status: publishedRow.status,
    criteria: publishedRow.criteria,
    blockers: publishedRow.blockers,
    updatedAt: publishedRow.updatedAt.toISOString(),
    updatedBy: publishedRow.updatedBy ?? undefined,
    publishedAt: publishedRow.publishedAt?.toISOString() ?? null,
  }) : null;
  const evaluation = evaluateReadiness({
    facts, rules,
    evidence: {
      equipmentId: equipment.id,
      inspectionId: inspection?.id ?? null,
      permitId: permit?.id ?? null,
      maintenanceRecordIds: openRecords.map((row) => row.id),
    },
    clock: capturedClock(now),
  });
  return {
    ...evaluation,
    ruleSetId: publishedRow?.id ?? 'missing-published-readiness-rules',
    serializedBlockers: evaluation.blockers as unknown as Prisma.InputJsonValue,
    serializedWarnings: evaluation.warnings as unknown as Prisma.InputJsonValue,
    serializedEvidence: evaluation.evidence as unknown as Prisma.InputJsonValue,
  };
}
