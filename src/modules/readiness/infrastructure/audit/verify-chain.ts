import {canonicalize} from '../../domain/audit/canonicalize';
import {digestAuditEvent} from '../../domain/audit/digest';
import type {AuditVerificationResult, CanonicalAuditEvent, StoredAuditEvent} from '../../domain/audit/types';
import type {AuditRepository} from './audit-repository';

const canonicalPart = (event: StoredAuditEvent): CanonicalAuditEvent => ({
  id: event.id,
  tenantId: event.tenantId,
  sequence: event.sequence,
  occurredAt: event.occurredAt,
  recordedAt: event.recordedAt,
  actor: event.actor,
  action: event.action,
  entity: event.entity,
  requestId: event.requestId,
  correlationId: event.correlationId,
  idempotencyKeyHash: event.idempotencyKeyHash,
  before: event.before,
  after: event.after,
  metadata: event.metadata,
});

export function verifyAuditEvents(
  tenantId: string,
  events: StoredAuditEvent[],
  expectedHead?: {lastSequence: bigint; headHash: Uint8Array | null} | null,
): AuditVerificationResult {
  let previousHash: string | null = null;
  let expectedSequence = BigInt(1);
  for (const event of events) {
    if (event.tenantId !== tenantId || event.sequence !== expectedSequence.toString()) {
      return {
        valid: false, eventCount: events.length,
        lastSequence: (expectedSequence - BigInt(1)).toString(), headHash: previousHash,
        brokenAtSequence: event.sequence, reason: 'SEQUENCE_GAP',
      };
    }
    if (event.prevHash !== previousHash) {
      return {
        valid: false, eventCount: events.length,
        lastSequence: (expectedSequence - BigInt(1)).toString(), headHash: previousHash,
        brokenAtSequence: event.sequence, reason: 'PREV_HASH_MISMATCH',
      };
    }
    const computed = digestAuditEvent({
      tenantId,
      sequence: event.sequence,
      prevHash: event.prevHash,
      canonicalEvent: canonicalize(canonicalPart(event)),
    });
    if (computed !== event.hash) {
      return {
        valid: false, eventCount: events.length,
        lastSequence: (expectedSequence - BigInt(1)).toString(), headHash: previousHash,
        brokenAtSequence: event.sequence, reason: 'HASH_MISMATCH',
      };
    }
    previousHash = event.hash;
    expectedSequence += BigInt(1);
  }
  const lastSequence = expectedSequence - BigInt(1);
  if (
    expectedHead
    && (expectedHead.lastSequence !== lastSequence
      || (expectedHead.headHash ? Buffer.from(expectedHead.headHash).toString('hex') : null) !== previousHash)
  ) {
    return {
      valid: false, eventCount: events.length,
      lastSequence: lastSequence.toString(), headHash: previousHash,
      reason: 'HEAD_MISMATCH',
    };
  }
  return {
    valid: true,
    eventCount: events.length,
    lastSequence: lastSequence.toString(),
    headHash: previousHash,
  };
}

export async function verifyTenantAuditChain(
  repository: AuditRepository,
  tenantId: string,
): Promise<AuditVerificationResult> {
  const {events, head} = await repository.readChain(tenantId);
  return verifyAuditEvents(tenantId, events, head);
}
