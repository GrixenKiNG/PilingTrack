import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findMany, findFirst } = vi.hoisted(() => ({ findMany: vi.fn(), findFirst: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { site: { findMany, findFirst } } }));
vi.mock('@/services/auth/resource-access-service', () => ({
  resolveAccessibleUserId: vi.fn((user: { id: string }) => user.id),
  assertCanAccessSite: vi.fn(),
}));

import { getAccessibleSites, getSiteWithHierarchy, listAllSitesForAdmin } from '../site-query.service';

describe('tenant-scoped site queries', () => {
  beforeEach(() => findMany.mockReset().mockResolvedValue([]));

  it('scopes privileged site list to tenant', async () => {
    await getAccessibleSites({ id: 'a', role: 'ADMIN' }, 'tenant-a');
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'tenant-a', isActive: true },
    }));
  });

  it('fails closed without tenant context', async () => {
    await expect(getAccessibleSites({ id: 'a', role: 'ADMIN' }, '')).rejects.toThrow('tenantId is required');
  });

  it('scopes admin overview and optionally includes inactive sites', async () => {
    await listAllSitesForAdmin('tenant-a', true);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'tenant-a' } }));
  });

  it('scopes site detail to tenant even for privileged roles', async () => {
    findFirst.mockResolvedValue({ id: 's1' });
    await getSiteWithHierarchy({ id: 'a', role: 'ADMIN' }, 'tenant-a', 's1');
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 's1', tenantId: 'tenant-a' } }));
  });
});
