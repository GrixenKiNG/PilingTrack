/**
 * PUT/DELETE /api/crews/[id] — tenant scoping.
 *
 * The actual cross-tenant IDOR guard (requireTenantCrew) lives in
 * crew-command.service.ts and is unit tested there (fail-closed, no role
 * bypass — unlike ensureTenantAccess, which crews.manage's ADMIN/DISPATCHER-
 * only roles would unconditionally skip). These tests only pin the route's
 * own job: resolve tenantId from the session and pass it through, and fail
 * closed before calling the command at all when the session has no tenant.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { ServiceError } from '@/lib/service-error';

const { requireAuthMock, getCrewByIdMock, updateCrewMock, deleteCrewMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  getCrewByIdMock: vi.fn(),
  updateCrewMock: vi.fn(),
  deleteCrewMock: vi.fn(),
}));

// ensureTenantAccess (the real one from resource-access-service) is NOT mocked:
// GET's cross-tenant guard must be exercised through it, not a stand-in.
vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/lib/csrf-protection', () => ({ withCsrf: () => null }));
vi.mock('@/modules/crews', () => ({
  getCrewById: getCrewByIdMock,
  updateCrew: updateCrewMock,
  deleteCrew: deleteCrewMock,
}));
vi.mock('../../cache', () => ({ invalidateCrewsCache: vi.fn() }));

import { GET, PUT, DELETE } from '../route';

const ADMIN = { id: 'admin-1', role: 'ADMIN', tenantId: 'tenant-a' };
const NO_TENANT = { id: 'admin-2', role: 'ADMIN', tenantId: null };

function putReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/crews/crew-1', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
function getReq(): NextRequest {
  return new NextRequest('http://localhost/api/crews/crew-1', { method: 'GET' });
}
function deleteReq(): NextRequest {
  return new NextRequest('http://localhost/api/crews/crew-1', { method: 'DELETE' });
}
function params() {
  return { params: Promise.resolve({ id: 'crew-1' }) };
}

describe('GET /api/crews/[id] — tenant scoping', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireAuthMock.mockResolvedValue({ user: ADMIN, error: null });
  });

  it('does not return a crew whose site belongs to another tenant (AUDIT-F01)', async () => {
    // Real ensureTenantAccess: user.tenantId = tenant-a, crew site.tenantId = tenant-b → 404.
    getCrewByIdMock.mockResolvedValue({
      id: 'crew-1',
      name: 'Чужая бригада',
      site: { id: 'site-b', name: 'Объект B', tenantId: 'tenant-b' },
    });

    const res = await GET(getReq(), params());
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.crew).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('Чужая бригада');
  });

  it('returns a crew whose site belongs to the session tenant (200)', async () => {
    getCrewByIdMock.mockResolvedValue({
      id: 'crew-1',
      name: 'Своя бригада',
      site: { id: 'site-a', name: 'Объект A', tenantId: 'tenant-a' },
    });

    const res = await GET(getReq(), params());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.crew).toEqual(expect.objectContaining({ id: 'crew-1', name: 'Своя бригада' }));
  });

  it('does not return a crew without a site to a regular tenant user', async () => {
    // crew.site === null → resourceTenantId null ≠ tenant-a → 404.
    getCrewByIdMock.mockResolvedValue({ id: 'crew-1', name: 'Бригада без объекта', site: null });

    const res = await GET(getReq(), params());
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.crew).toBeUndefined();
  });
});

describe('PUT /api/crews/[id] — tenant scoping', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireAuthMock.mockResolvedValue({ user: ADMIN, error: null });
    updateCrewMock.mockResolvedValue({ id: 'crew-1' });
  });

  it('passes the session tenantId through to updateCrew', async () => {
    const res = await PUT(putReq({ name: 'Renamed' }), params());

    expect(res.status).toBe(200);
    expect(updateCrewMock).toHaveBeenCalledWith(expect.objectContaining({ crewId: 'crew-1', tenantId: 'tenant-a' }));
  });

  it('fails closed (400) without calling updateCrew when the session has no tenant', async () => {
    requireAuthMock.mockResolvedValue({ user: NO_TENANT, error: null });
    const res = await PUT(putReq({ name: 'Renamed' }), params());

    expect(res.status).toBe(403);
    expect(updateCrewMock).not.toHaveBeenCalled();
  });

  it('surfaces the command-layer cross-tenant rejection (404, not leaked as 500)', async () => {
    updateCrewMock.mockRejectedValue(new ServiceError('Бригада не найдена', 404));
    const res = await PUT(putReq({ name: 'Renamed' }), params());
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/crews/[id] — tenant scoping', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireAuthMock.mockResolvedValue({ user: ADMIN, error: null });
    deleteCrewMock.mockResolvedValue({ ok: true });
  });

  it('passes the session tenantId through to deleteCrew', async () => {
    const res = await DELETE(deleteReq(), params());

    expect(res.status).toBe(200);
    expect(deleteCrewMock).toHaveBeenCalledWith(expect.objectContaining({ crewId: 'crew-1', tenantId: 'tenant-a' }));
  });

  it('fails closed (400) without calling deleteCrew when the session has no tenant', async () => {
    requireAuthMock.mockResolvedValue({ user: NO_TENANT, error: null });
    const res = await DELETE(deleteReq(), params());

    expect(res.status).toBe(403);
    expect(deleteCrewMock).not.toHaveBeenCalled();
  });

  it('surfaces the command-layer cross-tenant rejection (404, not leaked as 500)', async () => {
    deleteCrewMock.mockRejectedValue(new ServiceError('Бригада не найдена', 404));
    const res = await DELETE(deleteReq(), params());
    expect(res.status).toBe(404);
  });
});
