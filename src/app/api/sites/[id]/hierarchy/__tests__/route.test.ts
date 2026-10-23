/**
 * /api/sites/[id]/hierarchy — граница API схемы объекта.
 *
 * След `site.hierarchy.created` / `.deleted` (F-R34-15) пишут сами команды в одной
 * транзакции с узлом, имя удаляемого узла они читают до удаления
 * (site-hierarchy-guards.test.ts). Маршрут передаёт им объект, тенант и актора,
 * сбрасывает кэш объектов и отдаёт их отказы.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ requireAuth: mocks.auth }));
vi.mock('@/lib/csrf-protection', () => ({ withCsrf: () => null }));
vi.mock('@/modules/sites', () => ({ createSiteHierarchyItem: mocks.create, deleteSiteHierarchyItem: mocks.remove }));
vi.mock('@/lib/cached-queries', () => ({ invalidateSites: mocks.invalidate }));

import { DELETE, POST } from '../route';

const call = { params: Promise.resolve({ id: 's1' }) };
const json = (method: string, body: unknown) => new NextRequest('http://localhost/api/sites/s1/hierarchy', {
  method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: 'a', role: 'ADMIN', tenantId: 'tenant-a' }, error: null });
  mocks.invalidate.mockResolvedValue(undefined);
});

describe('DELETE /api/sites/[id]/hierarchy', () => {
  it('delegates canonical type/itemId with route and tenant context', async () => {
    mocks.remove.mockResolvedValue({ success: true });
    const res = await DELETE(json('DELETE', { type: 'cluster', itemId: 'c1' }), call);
    expect(res.status).toBe(200);
    expect(mocks.remove).toHaveBeenCalledWith('s1', 'cluster', 'c1', { tenantId: 'tenant-a', actorId: 'a' });
  });

  it('invalidates the sites cache after deleting a hierarchy item', async () => {
    mocks.remove.mockResolvedValue({ success: true });
    await DELETE(json('DELETE', { type: 'field', itemId: 'f1' }), call);
    expect(mocks.invalidate).toHaveBeenCalledWith('tenant-a');
  });

  it('сбой команды (в том числе записи следа) — ошибка, кэш не сбрасывается', async () => {
    mocks.remove.mockRejectedValue(new Error('след не записан'));
    const res = await DELETE(json('DELETE', { type: 'picket', itemId: 'p1' }), call);
    expect(res.status).toBe(500);
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });
});

describe('POST /api/sites/[id]/hierarchy', () => {
  it('передаёт команде объект, тип, имя, родителя, тенант и актора', async () => {
    mocks.create.mockResolvedValue({ id: 'p1', name: 'П-12' });

    const res = await POST(json('POST', { type: 'picket', name: 'П-12', parentId: 'c1' }), call);

    expect(res.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith(
      { siteId: 's1', type: 'picket', name: 'П-12', parentId: 'c1' },
      { tenantId: 'tenant-a', actorId: 'a' },
    );
    expect((await res.json()).item).toEqual({ id: 'p1', name: 'П-12' });
    expect(mocks.invalidate).toHaveBeenCalledWith('tenant-a');
  });

  it('сбой команды при создании — ошибка, а не «успех»', async () => {
    mocks.create.mockRejectedValue(new Error('след не записан'));
    const res = await POST(json('POST', { type: 'picket', name: 'П-12', parentId: 'c1' }), call);
    expect(res.status).toBe(500);
  });
});
