import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
  invalidate: vi.fn(),
  audit: vi.fn(),
  pileFieldFindFirst: vi.fn(),
  clusterFindFirst: vi.fn(),
  picketFindFirst: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ requireAuth: mocks.auth }));
vi.mock('@/lib/csrf-protection', () => ({ withCsrf: () => null }));
vi.mock('@/modules/sites', () => ({ createSiteHierarchyItem: mocks.create, deleteSiteHierarchyItem: mocks.remove }));
vi.mock('@/lib/cached-queries', () => ({ invalidateSites: mocks.invalidate }));
vi.mock('@/services/audit/audit-service', () => ({ recordAuditEvent: mocks.audit }));
vi.mock('@/lib/db', () => ({
  db: {
    pileField: { findFirst: mocks.pileFieldFindFirst },
    cluster: { findFirst: mocks.clusterFindFirst },
    picket: { findFirst: mocks.picketFindFirst },
  },
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: mocks.loggerWarn, error: mocks.loggerError, debug: vi.fn() },
}));

import { DELETE, POST } from '../route';

describe('DELETE /api/sites/[id]/hierarchy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: 'a', role: 'ADMIN', tenantId: 'tenant-a' }, error: null });
    mocks.invalidate.mockResolvedValue(undefined);
    mocks.audit.mockResolvedValue(undefined);
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

  it('invalidates the sites cache after deleting a hierarchy item', async () => {
    mocks.remove.mockResolvedValue({ success: true });
    const req = new NextRequest('http://localhost/api/sites/s1/hierarchy', {
      method: 'DELETE', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'field', itemId: 'f1' }),
    });
    await DELETE(req, { params: Promise.resolve({ id: 's1' }) });
    expect(mocks.invalidate).toHaveBeenCalledWith('tenant-a');
  });

  // Пикет — ключ привязки выработки (PileWork.picketId), и удаление узла ломает
  // связи задним числом: без следа этого не видно ни в одной ленте (F-R34-15).
  it('пишет след удаления с именем узла, прочитанным до удаления', async () => {
    mocks.remove.mockResolvedValue({ success: true });
    mocks.picketFindFirst.mockResolvedValue({ name: 'П-12' });
    const req = new NextRequest('http://localhost/api/sites/s1/hierarchy', {
      method: 'DELETE', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'picket', itemId: 'p1' }),
    });

    const res = await DELETE(req, { params: Promise.resolve({ id: 's1' }) });

    expect(res.status).toBe(200);
    // Имя читается до удаления и строго по объекту и тенанту.
    expect(mocks.picketFindFirst).toHaveBeenCalledWith({
      where: { id: 'p1', cluster: { field: { siteId: 's1', site: { tenantId: 'tenant-a' } } } },
      select: { name: true },
    });
    expect(mocks.audit).toHaveBeenCalledWith({
      action: 'site.hierarchy.deleted',
      scope: 'sites',
      actorId: 'a',
      targetId: 's1',
      tenantId: 'tenant-a',
      metadata: { type: 'picket', name: 'П-12', itemId: 'p1' },
    });
  });

  it('читает имя куста по схеме объекта', async () => {
    mocks.remove.mockResolvedValue({ success: true });
    mocks.clusterFindFirst.mockResolvedValue({ name: 'К-3' });
    const req = new NextRequest('http://localhost/api/sites/s1/hierarchy', {
      method: 'DELETE', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'cluster', itemId: 'c1' }),
    });

    await DELETE(req, { params: Promise.resolve({ id: 's1' }) });

    expect(mocks.clusterFindFirst).toHaveBeenCalledWith({
      where: { id: 'c1', field: { siteId: 's1', site: { tenantId: 'tenant-a' } } },
      select: { name: true },
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'site.hierarchy.deleted', metadata: { type: 'cluster', name: 'К-3', itemId: 'c1' } }),
    );
  });

  // Узел уже удалён: сбой записи следа не должен превращать успех в 500.
  it('не подменяет успешное удаление на 500, если запись следа упала', async () => {
    mocks.remove.mockResolvedValue({ success: true });
    mocks.picketFindFirst.mockResolvedValue({ name: 'П-12' });
    mocks.audit.mockRejectedValue(new Error('feedback table missing'));
    const req = new NextRequest('http://localhost/api/sites/s1/hierarchy', {
      method: 'DELETE', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'picket', itemId: 'p1' }),
    });

    const res = await DELETE(req, { params: Promise.resolve({ id: 's1' }) });

    expect(res.status).toBe(200);
    expect(mocks.loggerError).toHaveBeenCalled();
  });
});

describe('POST /api/sites/[id]/hierarchy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: 'a', role: 'ADMIN', tenantId: 'tenant-a' }, error: null });
    mocks.invalidate.mockResolvedValue(undefined);
    mocks.audit.mockResolvedValue(undefined);
  });

  it('пишет след создания узла схемы объекта', async () => {
    mocks.create.mockResolvedValue({ id: 'p1', name: 'П-12' });
    const req = new NextRequest('http://localhost/api/sites/s1/hierarchy', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'picket', name: 'П-12', parentId: 'c1' }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 's1' }) });

    expect(res.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith(
      { siteId: 's1', type: 'picket', name: 'П-12', parentId: 'c1' },
      { tenantId: 'tenant-a', actorId: 'a' },
    );
    expect(mocks.audit).toHaveBeenCalledWith({
      action: 'site.hierarchy.created',
      scope: 'sites',
      actorId: 'a',
      targetId: 's1',
      tenantId: 'tenant-a',
      metadata: { type: 'picket', name: 'П-12', itemId: 'p1' },
    });
  });

  it('не подменяет успешное создание на 500, если запись следа упала', async () => {
    mocks.create.mockResolvedValue({ id: 'p1', name: 'П-12' });
    mocks.audit.mockRejectedValue(new Error('feedback table missing'));
    const req = new NextRequest('http://localhost/api/sites/s1/hierarchy', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'picket', name: 'П-12', parentId: 'c1' }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: 's1' }) });

    expect(res.status).toBe(200);
    expect(mocks.loggerError).toHaveBeenCalled();
  });
});
