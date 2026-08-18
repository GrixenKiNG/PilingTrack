import { describe, expect, it, vi } from 'vitest';
import {
  runReadinessSerializableTransaction,
  runReadinessTenantTransaction,
} from '../tenant-transaction';

describe('readiness tenant transaction', () => {
  it('fails closed without a session-owned tenant', async () => {
    const client = { $transaction: vi.fn() };
    await expect(runReadinessTenantTransaction(client as never, '', vi.fn()))
      .rejects.toThrow('Контекст организации не определён');
    expect(client.$transaction).not.toHaveBeenCalled();
  });

  it('sets and verifies a transaction-local tenant before work', async () => {
    const executeRaw = vi.fn().mockResolvedValue(1);
    const queryRaw = vi.fn().mockResolvedValue([{ tenant_id: 'tenant-a' }]);
    const tx = { $executeRaw: executeRaw, $queryRaw: queryRaw };
    const client = {
      $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    const work = vi.fn().mockResolvedValue('done');

    await expect(
      runReadinessTenantTransaction(client as never, 'tenant-a', work)
    ).resolves.toBe('done');
    expect(executeRaw).toHaveBeenCalled();
    expect(queryRaw).toHaveBeenCalled();
    expect(work).toHaveBeenCalledWith(tx);
  });

  it('does not execute work when the database context is wrong', async () => {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      $queryRaw: vi.fn().mockResolvedValue([{ tenant_id: 'tenant-b' }]),
    };
    const client = {
      $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    const work = vi.fn();

    await expect(
      runReadinessTenantTransaction(client as never, 'tenant-a', work)
    ).rejects.toThrow('could not be established');
    expect(work).not.toHaveBeenCalled();
  });

  it('retries a serializable approval/edit conflict with tenant context restored', async () => {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      $queryRaw: vi.fn().mockResolvedValue([{ tenant_id: 'tenant-a' }]),
    };
    const transaction = vi.fn()
      .mockRejectedValueOnce({ code: 'P2034' })
      .mockImplementationOnce(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx));
    const work = vi.fn().mockResolvedValue('committed');

    await expect(runReadinessSerializableTransaction(
      { $transaction: transaction } as never,
      'tenant-a',
      work,
    )).resolves.toBe('committed');

    expect(transaction).toHaveBeenCalledTimes(2);
    expect(work).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('maps exhausted serialization conflicts to a stable 409 without exposing the database error', async () => {
    const databaseError = {code: 'P2034', message: 'database transaction failed'};
    const client = {$transaction: vi.fn().mockRejectedValue(databaseError)};
    const resolveConflictDetails = vi.fn().mockResolvedValue({current: {
      state: 'ACCEPTED', acceptedById: 'dispatcher-a', acceptedAt: '2026-08-01T09:00:00.000Z',
    }});

    await expect(runReadinessSerializableTransaction(
      client as never,
      'tenant-a',
      vi.fn(),
      {resolveConflictDetails},
    )).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
      status: 409,
      details: {current: {
        state: 'ACCEPTED',
        acceptedById: 'dispatcher-a',
        acceptedAt: '2026-08-01T09:00:00.000Z',
      }},
      headers: {'Retry-After': '1'},
    });

    expect(client.$transaction).toHaveBeenCalledTimes(3);
    expect(resolveConflictDetails).toHaveBeenCalledTimes(1);
  });
});
