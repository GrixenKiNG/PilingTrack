import { describe, expect, it, vi } from 'vitest';
import { runReadinessTenantTransaction } from '../tenant-transaction';

describe('readiness tenant transaction', () => {
  it('fails closed without a session-owned tenant', async () => {
    const client = { $transaction: vi.fn() };
    await expect(runReadinessTenantTransaction(client as never, '', vi.fn()))
      .rejects.toThrow('tenant context is required');
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
});
