export type AuditJsonPrimitive = string | number | boolean | null;
export type AuditJsonValue =
  | AuditJsonPrimitive
  | AuditJsonValue[]
  | {[key: string]: AuditJsonValue};

export interface AuditActor {
  id?: string | null;
  name?: string | null;
  role?: string | null;
  actingAs?: string | null;
}

export interface AppendAuditInput {
  tenantId: string;
  action: string;
  entityType: string;
  entityId: string;
  entityVersion?: number | null;
  actor?: AuditActor;
  requestId?: string | null;
  correlationId?: string | null;
  idempotencyKey?: string | null;
  occurredAt?: Date;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
}

export interface CanonicalAuditEvent {
  id: string;
  tenantId: string;
  sequence: string;
  occurredAt: string;
  recordedAt: string;
  actor: AuditActor;
  action: string;
  entity: {type: string; id: string; version: number | null};
  requestId: string | null;
  correlationId: string | null;
  idempotencyKeyHash: string | null;
  before: AuditJsonValue | null;
  after: AuditJsonValue | null;
  metadata: AuditJsonValue | null;
}

export interface StoredAuditEvent extends CanonicalAuditEvent {
  prevHash: string | null;
  hash: string;
}

export interface AuditChainHead {
  lastSequence: bigint;
  headHash: Uint8Array | null;
}

export interface AuditVerificationResult {
  valid: boolean;
  eventCount: number;
  lastSequence: string;
  headHash: string | null;
  brokenAtSequence?: string;
  reason?: 'SEQUENCE_GAP' | 'PREV_HASH_MISMATCH' | 'HASH_MISMATCH' | 'HEAD_MISMATCH';
}
