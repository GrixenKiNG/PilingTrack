import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cacheAside: vi.fn(),
  invalidate: vi.fn(),
  recordDeletion: vi.fn(),
  crewFindMany: vi.fn(),
}));

vi.mock('@/lib/cache-strategies', () => ({
  cacheAside: mocks.cacheAside,
  cacheAsideInvalidate: mocks.invalidate,
  writeThrough: vi.fn(),
}));
vi.mock('@/lib/redis-cache', () => ({ cache: { invalidatePattern: vi.fn() } }));
vi.mock('@/lib/cache-metrics', () => ({ recordDeletion: mocks.recordDeletion }));
vi.mock('@/lib/db', () => ({ db: { crew: { findMany: mocks.crewFindMany } } }));

import { getCachedCrewsAll, invalidateCrews } from '../cached-queries';

describe('tenant crews cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cacheAside.mockImplementation(async (_key: string, compute: () => Promise<unknown>) => compute());
    mocks.crewFindMany.mockResolvedValue([]);
  });

  it('кэширует бригады отдельным ключом и запросом для каждой организации', async () => {
    await getCachedCrewsAll('tenant-a');

    expect(mocks.cacheAside).toHaveBeenCalledWith('crews:tenant-a:all', expect.any(Function), expect.any(Object));
    expect(mocks.crewFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { isActive: true, site: { tenantId: 'tenant-a' } },
    }));
  });

  it('сброс снимает ключ только своей организации', async () => {
    await invalidateCrews('tenant-a');

    expect(mocks.invalidate).toHaveBeenCalledWith('crews:tenant-a:all');
    expect(mocks.recordDeletion).toHaveBeenCalledTimes(1);
  });
});
