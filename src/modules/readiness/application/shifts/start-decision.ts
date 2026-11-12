import {capturedClock} from '../../domain/evaluation/clock';
import {createDeduplicatedSnapshot} from '../../infrastructure/snapshots/snapshot-repository';
import type {ReadinessTransaction} from '../../infrastructure/tenant-transaction';
import {evaluateAuthoritativeReadiness} from '../readiness-score';
import {blockerFingerprint, waiverCoversBlockers} from '../../domain/shifts/waiver';

type ShiftStartInput = {
  tx: ReadinessTransaction;
  tenantId: string;
  equipmentId: string;
  shiftId: string;
  now: Date;
  timezone: string;
};

export async function previewAuthoritativeShiftStart(input: Omit<ShiftStartInput, 'shiftId'> & {shiftId?: string}) {
  const evaluation = await evaluateAuthoritativeReadiness({
    tx: input.tx, tenantId: input.tenantId, equipmentId: input.equipmentId,
    shiftId: input.shiftId, timezone: input.timezone, clock: capturedClock(input.now),
  });
  // Письменное разрешение диспетчера — единственный законный путь из отказа.
  // Оно покрывает ровно тот набор препятствий, который был на момент выдачи:
  // появилось новое — пуск снова закрыт, и это правильно.
  let waiver: {id: string; reason: string} | null = null;
  if (!evaluation.allowed && input.shiftId) {
    const issued = await input.tx.shiftStartWaiver.findFirst({
      where: {tenantId: input.tenantId, shiftId: input.shiftId},
      select: {id: true, reason: true, blockerFingerprint: true},
    });
    if (issued && waiverCoversBlockers(issued.blockerFingerprint, blockerFingerprint(evaluation.blockers))) {
      waiver = {id: issued.id, reason: issued.reason};
    }
  }
  return {evaluation, waiver, allowed: evaluation.allowed || waiver !== null};
}

export async function evaluateAuthoritativeShiftStart(input: ShiftStartInput) {
  const {evaluation, waiver, allowed} = await previewAuthoritativeShiftStart(input);
  const snapshot = await createDeduplicatedSnapshot(input.tx, {
    tenantId: input.tenantId, equipmentId: input.equipmentId, shiftId: input.shiftId,
    ruleSetId: evaluation.ruleSetId, triggerType: 'SHIFT_START_DECISION',
    // A committed command retry is absorbed by the idempotency pipeline, while a
    // later attempt after corrective work must produce a fresh authoritative decision.
    triggerId: `${input.shiftId}:start:${input.now.toISOString()}`,
  }, evaluation);

  if (allowed) {
    await input.tx.shift.updateMany({
      where: {tenantId: input.tenantId, id: input.shiftId, startSnapshotId: null},
      data: {startSnapshotId: snapshot.id},
    });
  }
  return {
    allowed, score: evaluation.score, blockers: evaluation.blockers,
    warnings: evaluation.warnings, snapshotId: snapshot.id, ruleSetId: snapshot.ruleSetId,
    ruleSetVersion: snapshot.ruleSetVersion,
    // Разрешение попадает в доказательства пуска: по снимку видно не только
    // что машину выпустили с препятствиями, но и на каком основании.
    evidence: waiver
      ? {...evaluation.evidence, startWaiver: {id: waiver.id, reason: waiver.reason}}
      : evaluation.evidence,
  };
}
