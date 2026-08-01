import {capturedClock} from '../../domain/evaluation/clock';
import {createDeduplicatedSnapshot} from '../../infrastructure/snapshots/snapshot-repository';
import type {ReadinessTransaction} from '../../infrastructure/tenant-transaction';
import {evaluateAuthoritativeReadiness} from '../readiness-score';

export async function evaluateAuthoritativeShiftStart(input: {
  tx: ReadinessTransaction;
  tenantId: string;
  equipmentId: string;
  shiftId: string;
  now: Date;
  timezone: string;
}) {
  const evaluation = await evaluateAuthoritativeReadiness({
    tx: input.tx, tenantId: input.tenantId, equipmentId: input.equipmentId,
    shiftId: input.shiftId, timezone: input.timezone, clock: capturedClock(input.now),
  });
  const snapshot = await createDeduplicatedSnapshot(input.tx, {
    tenantId: input.tenantId, equipmentId: input.equipmentId, shiftId: input.shiftId,
    ruleSetId: evaluation.ruleSetId, triggerType: 'SHIFT_START_DECISION',
    // A committed command retry is absorbed by the idempotency pipeline, while a
    // later attempt after corrective work must produce a fresh authoritative decision.
    triggerId: `${input.shiftId}:start:${input.now.toISOString()}`,
  }, evaluation);
  if (evaluation.allowed) {
    await input.tx.shift.updateMany({
      where: {tenantId: input.tenantId, id: input.shiftId, startSnapshotId: null},
      data: {startSnapshotId: snapshot.id},
    });
  }
  return {
    allowed: evaluation.allowed, score: evaluation.score, blockers: evaluation.blockers,
    warnings: evaluation.warnings, snapshotId: snapshot.id, ruleSetId: snapshot.ruleSetId,
    ruleSetVersion: snapshot.ruleSetVersion, evidence: evaluation.evidence,
  };
}
