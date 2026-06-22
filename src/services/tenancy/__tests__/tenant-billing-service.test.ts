import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  tenantCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: { $transaction: mocks.transaction },
}));

vi.mock('@/services/dictionaries/tenant-dictionary-initializer', () => ({
  initializeTenantDictionaries: mocks.initialize,
}));

import { createTenant } from '../tenant-billing-service';

describe('createTenant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tenantCreate.mockResolvedValue({ id: 'tenant-a', slug: 'alpha', name: 'Alpha' });
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({ tenant: { create: mocks.tenantCreate } })
    );
  });

  it('creates the tenant and initializes dictionaries in the same transaction', async () => {
    await createTenant({ slug: 'alpha', name: 'Alpha' });

    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ tenant: { create: mocks.tenantCreate } }),
      'tenant-a'
    );
  });
});
