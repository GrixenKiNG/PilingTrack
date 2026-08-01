import {describe, expect, it} from 'vitest';
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
});
