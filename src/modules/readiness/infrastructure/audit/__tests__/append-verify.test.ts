import {describe, expect, it} from 'vitest';
import {traceContext} from '@/lib/request-context';
import type {AuditChainHead, StoredAuditEvent} from '../../../domain/audit/types';
import {appendAuditEvent} from '../append-audit';
import type {AuditRepository} from '../audit-repository';
import {verifyAuditEvents} from '../verify-chain';

class MemoryAuditRepository implements AuditRepository {
  private head: AuditChainHead = {lastSequence: BigInt(0), headHash: null};
  private events: StoredAuditEvent[] = [];
  private queue = Promise.resolve();
  private activeRelease: (() => void) | null = null;

  async ensureChain() {}
  async lockChain(): Promise<AuditChainHead> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    this.activeRelease = release;
    return {...this.head};
  }
  async insert(event: StoredAuditEvent) { this.events.push(structuredClone(event)); }
  async advanceChain(_tenantId: string, previousSequence: bigint, hash: Uint8Array) {
    if (this.head.lastSequence !== previousSequence) throw new Error('chain race');
    this.head = {lastSequence: previousSequence + BigInt(1), headHash: Uint8Array.from(hash)};
    const release = this.activeRelease;
    this.activeRelease = null;
    release?.();
  }
  async readChain(_tenantId?: string) {
    return {events: structuredClone(this.events), head: {...this.head}};
  }
}

describe('audit append and verifier', () => {
  it('serializes concurrent appends into a contiguous tenant chain', async () => {
    const repository = new MemoryAuditRepository();
    const events = await Promise.all(Array.from({length: 20}, (_, index) => appendAuditEvent(repository, {
      tenantId: 'tenant-1', action: 'test.appended', entityType: 'Test', entityId: String(index),
      metadata: {index}, occurredAt: new Date('2026-07-29T09:00:00.000Z'),
    })));
    expect(events.map((event) => BigInt(event.sequence)).sort((a, b) => a < b ? -1 : 1))
      .toEqual(Array.from({length: 20}, (_, index) => BigInt(index + 1)));
    const stored = await repository.readChain('tenant-1');
    expect(verifyAuditEvents('tenant-1', stored.events, stored.head)).toMatchObject({
      valid: true, eventCount: 20, lastSequence: '20',
    });
  });

  it('persists and hashes the same masked payload and never stores the raw key', async () => {
    const repository = new MemoryAuditRepository();
    const event = await appendAuditEvent(repository, {
      tenantId: 'tenant-1', action: 'test.masked', entityType: 'Test', entityId: '1',
      idempotencyKey: 'raw-idempotency-key',
      after: {email: 'operator@example.test', nested: {token: 'secret', safe: 'visible'}},
    });
    expect(event.after).toEqual({email: '[REDACTED]', nested: {token: '[REDACTED]', safe: 'visible'}});
    expect(event.idempotencyKeyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(event)).not.toContain('raw-idempotency-key');
    expect(verifyAuditEvents('tenant-1', [event], {lastSequence: BigInt(1), headHash: Uint8Array.from(Buffer.from(event.hash, 'hex'))}))
      .toMatchObject({valid: true});
  });

  it('detects changed content, gaps and chain-head divergence without repair', async () => {
    const repository = new MemoryAuditRepository();
    const first = await appendAuditEvent(repository, {
      tenantId: 'tenant-1', action: 'test.first', entityType: 'Test', entityId: '1',
    });
    const second = await appendAuditEvent(repository, {
      tenantId: 'tenant-1', action: 'test.second', entityType: 'Test', entityId: '2',
    });
    expect(verifyAuditEvents('tenant-1', [{...first, action: 'tampered'}, second])).toMatchObject({
      valid: false, brokenAtSequence: '1', reason: 'HASH_MISMATCH',
    });
    expect(verifyAuditEvents('tenant-1', [{...second, sequence: '3'}])).toMatchObject({
      valid: false, brokenAtSequence: '3', reason: 'SEQUENCE_GAP',
    });
    expect(verifyAuditEvents('tenant-1', [first, second], {lastSequence: BigInt(3), headHash: Uint8Array.from(Buffer.from(second.hash, 'hex'))}))
      .toMatchObject({valid: false, reason: 'HEAD_MISMATCH'});
  });

  describe('chain metadata (R87 №2: DB CHECK AuditLog_native_chain_complete)', () => {
    it('fills requestId/correlationId for chained events and hashes them', async () => {
      const repository = new MemoryAuditRepository();
      const event = await appendAuditEvent(repository, {
        tenantId: 'tenant-1', action: 'test.chain-metadata', entityType: 'Test', entityId: '1',
      });
      expect(event.requestId).toBeTruthy();
      expect(event.correlationId).toBe(event.requestId);
      const stored = await repository.readChain('tenant-1');
      expect(verifyAuditEvents('tenant-1', stored.events, stored.head)).toMatchObject({valid: true});
    });

    it('takes requestId from the trace context when the caller omits it', async () => {
      const repository = new MemoryAuditRepository();
      const event = await traceContext.run(
        {traceId: 'trace-1', spanId: 'span-1', requestId: 'ctx-request-id'},
        () => appendAuditEvent(repository, {
          tenantId: 'tenant-1', action: 'test.chain-context', entityType: 'Test', entityId: '1',
        }),
      );
      expect(event.requestId).toBe('ctx-request-id');
      expect(event.correlationId).toBe('ctx-request-id');
    });

    it('never overwrites requestId/correlationId supplied by the caller', async () => {
      const repository = new MemoryAuditRepository();
      const event = await traceContext.run(
        {traceId: 'trace-1', spanId: 'span-1', requestId: 'ctx-ignored'},
        () => appendAuditEvent(repository, {
          tenantId: 'tenant-1', action: 'test.chain-explicit', entityType: 'Test', entityId: '1',
          requestId: 'given-request', correlationId: 'given-correlation',
        }),
      );
      expect(event.requestId).toBe('given-request');
      expect(event.correlationId).toBe('given-correlation');
    });

    it('mirrors the AuditLog_native_chain_complete CHECK on every stored link', async () => {
      const repository = new MemoryAuditRepository();
      const event = await appendAuditEvent(repository, {
        tenantId: 'tenant-1', action: 'test.chain-check', entityType: 'Test', entityId: '1',
      });
      // CHECK: hash IS NULL OR (все перечисленные поля IS NOT NULL) — у звена с хэшем.
      expect(event.hash).toBeTruthy();
      expect(event.tenantId).toBeTruthy();
      expect(event.sequence).toBeTruthy();
      expect(event.occurredAt).toBeTruthy();
      expect(event.recordedAt).toBeTruthy();
      expect(event.entity.type).toBeTruthy();
      expect(event.requestId).toBeTruthy();
      expect(event.correlationId).toBeTruthy();
      expect(event.metadata).not.toBeNull();
    });
  });
});
