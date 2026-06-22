import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cacheAside: vi.fn(),
  invalidate: vi.fn(),
  recordDeletion: vi.fn(),
  pileGradeFindMany: vi.fn(),
  drillingTypeFindMany: vi.fn(),
  downtimeReasonFindMany: vi.fn(),
}));

vi.mock('@/lib/cache-strategies', () => ({
  cacheAside: mocks.cacheAside,
  cacheAsideInvalidate: mocks.invalidate,
  writeThrough: vi.fn(),
}));
vi.mock('@/lib/cache-metrics', () => ({ recordDeletion: mocks.recordDeletion }));
vi.mock('@/lib/db', () => ({
  db: {
    pileGrade: { findMany: mocks.pileGradeFindMany },
    drillingType: { findMany: mocks.drillingTypeFindMany },
    downtimeReason: { findMany: mocks.downtimeReasonFindMany },
  },
}));

import { getCachedAllDictionaries, invalidateDictionaries } from '../cached-queries';

describe('tenant dictionary cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cacheAside.mockImplementation(async (_key: string, compute: () => Promise<unknown>) => compute());
    mocks.pileGradeFindMany.mockResolvedValue([]);
    mocks.drillingTypeFindMany.mockResolvedValue([]);
    mocks.downtimeReasonFindMany.mockResolvedValue([]);
  });

  it('uses a separate cache key and query scope for each tenant', async () => {
    await getCachedAllDictionaries('tenant-a');

    expect(mocks.cacheAside).toHaveBeenCalledWith(
      'dictionary:tenant-a:all', expect.any(Function), expect.any(Object)
    );
    expect(mocks.pileGradeFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant-a', isActive: true },
    }));
  });

  it('invalidates only the selected tenant key', async () => {
    await invalidateDictionaries('tenant-a');

    expect(mocks.invalidate).toHaveBeenCalledWith('dictionary:tenant-a:all');
    expect(mocks.invalidate).not.toHaveBeenCalledWith('dictionary:tenant-b:all');
  });
});
