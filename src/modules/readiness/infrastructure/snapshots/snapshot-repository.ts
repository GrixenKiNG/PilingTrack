import {createHash, randomUUID} from 'node:crypto';
import {canonicalize} from '../../domain/audit/canonicalize';
import type {AuthoritativeEvaluation} from '../../domain/evaluation/evaluator';
import type {ReadinessTransaction} from '../tenant-transaction';

export interface SnapshotIdentity {
  tenantId: string;
  equipmentId: string;
  shiftId?: string | null;
  ruleSetId: string;
  triggerType: string;
  triggerId: string;
}

export async function createDeduplicatedSnapshot(
  tx: ReadinessTransaction,
  identity: SnapshotIdentity,
  evaluation: AuthoritativeEvaluation,
) {
  const factsHash = createHash('sha256')
    .update(canonicalize({facts: evaluation.facts, evidence: evaluation.evidence}))
    .digest();
  const id = randomUUID();
  const inserted = await tx.$queryRaw<Array<{id: string}>>`
    INSERT INTO "ReadinessScoreSnapshot"
      ("id", "tenantId", "equipmentId", "shiftId", "ruleSetId", "ruleSetVersion",
       "triggerType", "triggerId", "status", "score", "blockers", "warnings",
       "evidence", "factsHash", "calculatedAt")
    VALUES
      (${id}, ${identity.tenantId}, ${identity.equipmentId}, ${identity.shiftId ?? null},
       ${identity.ruleSetId}, ${evaluation.ruleSetVersion}, ${identity.triggerType}, ${identity.triggerId},
       ${evaluation.status}, ${evaluation.score}, ${JSON.stringify(evaluation.blockers)}::jsonb,
       ${JSON.stringify(evaluation.warnings)}::jsonb, ${JSON.stringify(evaluation.evidence)}::jsonb,
       ${factsHash}, ${evaluation.calculatedAt})
    ON CONFLICT ("tenantId", "equipmentId", "triggerType", "triggerId") DO NOTHING
    RETURNING "id"
  `;
  const snapshot = await tx.readinessScoreSnapshot.findUnique({
    where: {id: inserted[0]?.id ?? id},
  }) ?? await tx.readinessScoreSnapshot.findUnique({
    where: {tenantId_equipmentId_triggerType_triggerId: {
      tenantId: identity.tenantId, equipmentId: identity.equipmentId,
      triggerType: identity.triggerType, triggerId: identity.triggerId,
    }},
  });
  if (!snapshot) throw new Error('Readiness snapshot insert could not be resolved');
  return snapshot;
}
