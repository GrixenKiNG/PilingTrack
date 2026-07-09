/**
 * Equipment Repository — outbox atomicity (audit finding #3)
 *
 * save() used to call `db.equipment.upsert()` directly (a standalone write,
 * already committed the moment it resolves), then separately
 * `Promise.all(events.map(e => db.outboxEvent.create(...)))`. If the upsert
 * succeeded but any outbox create failed, the equipment change was
 * permanently persisted while its domain event was silently lost — no
 * retry, no compensating action. site.repository.ts and report.repository.ts
 * (the DDD-migration reference, per CLAUDE.md) both already wrap the
 * equivalent upsert+outbox write in a single `db.$transaction`; equipment
 * was the outlier.
 *
 * These tests use a fake interactive-transaction client (same pattern as
 * report.repository.test.ts) plus SEPARATE top-level mocks for
 * db.equipment.upsert / db.outboxEvent.create, so a regression back to the
 * old "write outside any transaction" shape is caught structurally: if
 * save() ever calls the top-level (non-tx) methods again, these tests fail.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EquipmentAggregate } from '../../domain';

const { tx, dbEquipmentUpsert, dbOutboxCreate, transactionMock } = vi.hoisted(() => {
  const tx = {
    equipment: { upsert: vi.fn().mockResolvedValue({}) },
    outboxEvent: { create: vi.fn().mockResolvedValue({}) },
  };
  return {
    tx,
    // Top-level (non-transactional) equivalents. After the fix, save() must
    // never call these directly — everything goes through `tx` inside $transaction.
    dbEquipmentUpsert: vi.fn().mockResolvedValue({}),
    dbOutboxCreate: vi.fn().mockResolvedValue({}),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test transaction shim
    transactionMock: vi.fn((cb: any) => cb(tx)),
  };
});

vi.mock('@/lib/db', () => ({
  db: {
    $transaction: transactionMock,
    equipment: { upsert: dbEquipmentUpsert },
    outboxEvent: { create: dbOutboxCreate },
  },
}));

import { PrismaEquipmentRepository } from '../equipment.repository';

function makeAggregate(): EquipmentAggregate {
  // .create() seeds exactly one pending event (EquipmentCreated).
  return EquipmentAggregate.create({ name: 'Копёр-1', tenantId: 'orion' });
}

describe('PrismaEquipmentRepository.save — transactional outbox', () => {
  const repo = new PrismaEquipmentRepository();

  beforeEach(() => {
    vi.clearAllMocks();
    tx.equipment.upsert.mockResolvedValue({});
    tx.outboxEvent.create.mockResolvedValue({});
  });

  it('writes the equipment upsert and outbox event inside a single $transaction', async () => {
    await repo.save(makeAggregate());

    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(tx.equipment.upsert).toHaveBeenCalledTimes(1);
    expect(tx.outboxEvent.create).toHaveBeenCalledTimes(1); // one pending event

    // Neither write happens outside the transaction.
    expect(dbEquipmentUpsert).not.toHaveBeenCalled();
    expect(dbOutboxCreate).not.toHaveBeenCalled();
  });

  it('propagates failure (and thus rolls back) when an outbox write fails', async () => {
    tx.outboxEvent.create.mockRejectedValue(new Error('db unavailable'));

    await expect(repo.save(makeAggregate())).rejects.toThrow('db unavailable');

    // A real $transaction rolls back automatically because both writes
    // happen on the SAME tx client. This structurally confirms the
    // equipment upsert can no longer be committed standalone before the
    // outbox write is attempted (both are proposed within one callback).
    expect(tx.equipment.upsert).toHaveBeenCalledTimes(1);
  });

  it('still commits cleanly when there are no pending events', async () => {
    const agg = makeAggregate();
    // Simulate a repository call after events were already flushed once.
    agg.clearPendingEvents();

    await repo.save(agg);

    expect(tx.equipment.upsert).toHaveBeenCalledTimes(1);
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
  });
});
