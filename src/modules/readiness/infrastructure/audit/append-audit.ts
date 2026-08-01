import {randomUUID} from 'node:crypto';
import {canonicalize} from '../../domain/audit/canonicalize';
import {digestAuditEvent, digestIdempotencyKey} from '../../domain/audit/digest';
import {maskOptionalAuditPayload} from '../../domain/audit/mask';
import type {AppendAuditInput, CanonicalAuditEvent, StoredAuditEvent} from '../../domain/audit/types';
import type {AuditRepository} from './audit-repository';

export interface AuditShadowObserver {
  appended?(tenantId: string): void;
  failed?(tenantId: string, error: unknown): void;
}

const required = (value: string, name: string): string => {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${name} is required`);
  return normalized;
};

export async function appendAuditEvent(
  repository: AuditRepository,
  input: AppendAuditInput,
  observer?: AuditShadowObserver,
): Promise<StoredAuditEvent> {
  const tenantId = required(input.tenantId, 'tenantId');
  try {
    const recordedAt = new Date();
    const occurredAt = input.occurredAt ?? recordedAt;
    if (Number.isNaN(occurredAt.getTime())) throw new TypeError('occurredAt is invalid');
    await repository.ensureChain(tenantId);
    const head = await repository.lockChain(tenantId);
    const sequence = head.lastSequence + BigInt(1);
    const prevHash = head.headHash ? Buffer.from(head.headHash).toString('hex') : null;
    const actor = {
      id: input.actor?.id ?? null,
      name: input.actor?.name ?? null,
      role: input.actor?.role ?? null,
      actingAs: input.actor?.actingAs ?? null,
    };
    const event: CanonicalAuditEvent = {
      id: randomUUID(),
      tenantId,
      sequence: sequence.toString(),
      occurredAt: occurredAt.toISOString(),
      recordedAt: recordedAt.toISOString(),
      actor,
      action: required(input.action, 'action'),
      entity: {
        type: required(input.entityType, 'entityType'),
        id: required(input.entityId, 'entityId'),
        version: input.entityVersion ?? null,
      },
      requestId: input.requestId ?? null,
      correlationId: input.correlationId ?? null,
      idempotencyKeyHash: input.idempotencyKey
        ? digestIdempotencyKey(input.idempotencyKey)
        : null,
      before: maskOptionalAuditPayload(input.before),
      after: maskOptionalAuditPayload(input.after),
      metadata: maskOptionalAuditPayload(input.metadata),
    };
    const hash = digestAuditEvent({
      tenantId,
      sequence: event.sequence,
      prevHash,
      canonicalEvent: canonicalize(event),
    });
    const stored: StoredAuditEvent = {...event, prevHash, hash};
    await repository.insert(stored);
    await repository.advanceChain(tenantId, head.lastSequence, Uint8Array.from(Buffer.from(hash, 'hex')));
    observer?.appended?.(tenantId);
    return stored;
  } catch (error) {
    observer?.failed?.(tenantId, error);
    throw error;
  }
}
