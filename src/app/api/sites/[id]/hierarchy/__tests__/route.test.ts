import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), create: vi.fn(), remove: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireAuth: mocks.auth }));
vi.mock('@/lib/csrf-protection', () => ({ withCsrf: () => null }));
vi.mock('@/modules/sites', () => ({ createSiteHierarchyItem: mocks.create, deleteSiteHierarchyItem: mocks.remove }));

import { DELETE } from '../route';

describe('DELETE /api/sites/[id]/hierarchy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: 'a', role: 'ADMIN', tenantId: 'tenant-a' }, error: null });
  });

  it('delegates canonical type/itemId with route and tenant context', async () => {
    mocks.remove.mockResolvedValue({ success: true });
    const req = new NextRequest('http://localhost/api/sites/s1/hierarchy', {
      method: 'DELETE', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'cluster', itemId: 'c1' }),
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: 's1' }) });
    expect(res.status).toBe(200);
    expect(mocks.remove).toHaveBeenCalledWith('s1', 'cluster', 'c1', { tenantId: 'tenant-a', actorId: 'a' });
  });
});
