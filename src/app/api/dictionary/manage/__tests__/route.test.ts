import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { requireAuthMock, svc } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  svc: {
    listDictionaries: vi.fn(),
    getDictionaryUsage: vi.fn(),
    createDictionaryItem: vi.fn(),
    archiveDictionaryItem: vi.fn(),
    restoreDictionaryItem: vi.fn(),
    renameDictionaryItem: vi.fn(),
    deleteDictionaryItem: vi.fn(),
    setPileGradeLength: vi.fn(),
  },
}));
const invalidateDictionaries = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/lib/csrf-protection', () => ({ withCsrf: () => null }));
vi.mock('@/services/dictionaries/dictionary-service', () => svc);
vi.mock('@/lib/cached-queries', () => ({ invalidateDictionaries }));

import { GET, POST, PATCH, DELETE } from '../route';

const admin = { user: { id: 'a', role: 'ADMIN', tenantId: 'tenant-a' }, error: null };
function req(method: string, body?: unknown, qs = ''): NextRequest {
  return new NextRequest(`http://localhost/api/dictionary/manage${qs}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('dictionary/manage route', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('GET returns 403 for non-admin', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'o', role: 'OPERATOR' }, error: null });
    expect((await GET(req('GET', undefined, '?filter=all'))).status).toBe(403);
  });

  it('GET fails closed when the admin has no tenant', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'a', role: 'ADMIN', tenantId: null }, error: null });
    expect((await GET(req('GET'))).status).toBe(400);
    expect(svc.listDictionaries).not.toHaveBeenCalled();
  });

  it('GET returns items merged with usage counts', async () => {
    requireAuthMock.mockResolvedValue(admin);
    svc.listDictionaries.mockResolvedValue({
      pileGrades: [{ id: 'g1', name: 'С120', isActive: true, updatedAt: '2026-05-01' }],
      drillingTypes: [], downtimeReasons: [],
    });
    svc.getDictionaryUsage.mockResolvedValue({
      pileGrade: { g1: { reportCount: 42, planCount: 0 } }, drillingType: {}, downtimeReason: {},
    });
    const res = await GET(req('GET', undefined, '?filter=active'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pileGrades[0]).toMatchObject({ id: 'g1', reportCount: 42, planCount: 0 });
    expect(svc.listDictionaries).toHaveBeenCalledWith('tenant-a', 'active');
    expect(svc.getDictionaryUsage).toHaveBeenCalledWith('tenant-a');
  });

  it('POST creates an item only inside the authenticated tenant', async () => {
    requireAuthMock.mockResolvedValue(admin);
    svc.createDictionaryItem.mockResolvedValue({ id: 'g1' });
    const res = await POST(req('POST', {
      type: 'pileGrade', name: 'СВ 120-35', code: 'СВ120', lengthMm: 12000,
    }));
    expect(res.status).toBe(200);
    expect(svc.createDictionaryItem).toHaveBeenCalledWith({ tenantId: 'tenant-a', actorId: 'a' }, 'pileGrade', {
      name: 'СВ 120-35', code: 'СВ120', lengthMm: 12000,
    });
  });

  it('POST rejects a pile grade without a positive explicit length', async () => {
    requireAuthMock.mockResolvedValue(admin);

    expect((await POST(req('POST', { type: 'pileGrade', name: 'СВ 120-35' }))).status).toBe(400);
    expect((await POST(req('POST', { type: 'pileGrade', name: 'СВ 120-35', lengthMm: 0 }))).status).toBe(400);
    expect(svc.createDictionaryItem).not.toHaveBeenCalled();
  });

  it('PATCH renames when name is present', async () => {
    requireAuthMock.mockResolvedValue(admin);
    svc.renameDictionaryItem.mockResolvedValue({ id: 'g1', name: 'X' });
    const res = await PATCH(req('PATCH', { type: 'pileGrade', id: 'g1', name: 'X' }));
    expect(res.status).toBe(200);
    expect(svc.renameDictionaryItem).toHaveBeenCalledWith({ tenantId: 'tenant-a', actorId: 'a' }, 'pileGrade', 'g1', 'X');
  });

  it('PATCH archives when isActive=false', async () => {
    requireAuthMock.mockResolvedValue(admin);
    svc.archiveDictionaryItem.mockResolvedValue({ id: 'g1' });
    await PATCH(req('PATCH', { type: 'pileGrade', id: 'g1', isActive: false }));
    expect(svc.archiveDictionaryItem).toHaveBeenCalledWith({ tenantId: 'tenant-a', actorId: 'a' }, 'pileGrade', 'g1');
  });

  it('PATCH returns 400 with neither name nor isActive', async () => {
    requireAuthMock.mockResolvedValue(admin);
    expect((await PATCH(req('PATCH', { type: 'pileGrade', id: 'g1' }))).status).toBe(400);
  });

  it('DELETE maps the service 409 to HTTP 409', async () => {
    requireAuthMock.mockResolvedValue(admin);
    const { ServiceError } = await import('@/services/service-error');
    svc.deleteDictionaryItem.mockRejectedValue(new ServiceError('используется', 409));
    expect((await DELETE(req('DELETE', { type: 'pileGrade', id: 'g1' }))).status).toBe(409);
  });

  it('DELETE returns 200 when unused', async () => {
    requireAuthMock.mockResolvedValue(admin);
    svc.deleteDictionaryItem.mockResolvedValue({ success: true });
    expect((await DELETE(req('DELETE', { type: 'pileGrade', id: 'g1' }))).status).toBe(200);
    expect(svc.deleteDictionaryItem).toHaveBeenCalledWith({ tenantId: 'tenant-a', actorId: 'a' }, 'pileGrade', 'g1');
  });
});
