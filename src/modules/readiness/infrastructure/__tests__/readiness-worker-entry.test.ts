import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  withWorkerTransaction: vi.fn(),
}));

vi.mock('../tenant-transaction', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../tenant-transaction')>();
  return {
    ...actual,
    withReadinessWorkerTransaction: mocks.withWorkerTransaction,
  };
});

import { executeReadinessWorkerJob } from '../readiness-worker-entry';

describe('readiness worker entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.withWorkerTransaction.mockImplementation(
      async (_tenantId: string, work: (tx: object) => Promise<unknown>) => work({ scoped: true })
    );
  });

  it('runs a persisted job through the tenant-local worker transaction', async () => {
    const job = {
      id: 'job-1',
      tenantId: 'tenant-a',
      kind: 'READINESS_RECALCULATE',
      payload: { equipmentId: 'eq-1' },
    };
    const handler = vi.fn().mockResolvedValue('done');

    await expect(executeReadinessWorkerJob(job, handler)).resolves.toBe('done');
    expect(mocks.withWorkerTransaction).toHaveBeenCalledWith('tenant-a', expect.any(Function));
    expect(handler).toHaveBeenCalledWith({ scoped: true }, job);
  });

  it('rejects malformed job identity before opening a transaction', async () => {
    await expect(executeReadinessWorkerJob(
      { id: '', tenantId: 'tenant-a', kind: 'READINESS_RECALCULATE', payload: {} },
      vi.fn()
    )).rejects.toThrow('job identity is required');
    expect(mocks.withWorkerTransaction).not.toHaveBeenCalled();
  });
});
