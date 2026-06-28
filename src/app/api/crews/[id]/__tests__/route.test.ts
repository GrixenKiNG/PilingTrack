/**
 * PUT/DELETE /api/crews/[id] — regression for the missing tenant check.
 *
 * GET already called ensureTenantAccess before this fix; PUT/DELETE didn't,
 * so a crew belonging to a different tenant could be mutated/deleted
 * without ever being read-access-checked first. These tests pin that PUT
 * and DELETE now call ensureTenantAccess with the crew's tenantId, same as
 * GET. (ensureTenantAccess's own role/MULTI_TENANT_MODE behavior is unit
 * tested separately in resource-access-service.test.ts — not re-tested here.)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { ServiceError } from '@/lib/service-error';

const { requireAuthMock, getCrewByIdMock, updateCrewMock, deleteCrewMock, ensureTenantAccessMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  getCrewByIdMock: vi.fn(),
  updateCrewMock: vi.fn(),
  deleteCrewMock: vi.fn(),
  ensureTenantAccessMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/lib/csrf-protection', () => ({ withCsrf: () => null }));
vi.mock('@/services/auth/resource-access-service', () => ({ ensureTenantAccess: ensureTenantAccessMock }));
vi.mock('@/modules/crews', () => ({
  getCrewById: getCrewByIdMock,
  updateCrew: updateCrewMock,
  deleteCrew: deleteCrewMock,
}));
vi.mock('../../cache', () => ({ invalidateCrewsCache: vi.fn() }));

import { PUT, DELETE } from '../route';

const ADMIN = { id: 'admin-1', role: 'ADMIN', tenantId: 'tenant-a' };

function putReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/crews/crew-1', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
function deleteReq(): NextRequest {
  return new NextRequest('http://localhost/api/crews/crew-1', { method: 'DELETE' });
}
function params() {
  return { params: Promise.resolve({ id: 'crew-1' }) };
}

describe('PUT /api/crews/[id] — tenant check', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireAuthMock.mockResolvedValue({ user: ADMIN, error: null });
    getCrewByIdMock.mockResolvedValue({ id: 'crew-1', site: { tenantId: 'tenant-b' } });
    updateCrewMock.mockResolvedValue({ id: 'crew-1' });
  });

  it('checks tenant access against the crew being mutated before updating', async () => {
    const res = await PUT(putReq({ name: 'Renamed' }), params());

    expect(res.status).toBe(200);
    expect(ensureTenantAccessMock).toHaveBeenCalledWith(ADMIN, 'tenant-b', 'Crew');
    // ensureTenantAccess must run before the mutation, not after.
    expect(ensureTenantAccessMock.mock.invocationCallOrder[0])
      .toBeLessThan(updateCrewMock.mock.invocationCallOrder[0]);
  });

  it('does not call updateCrew when ensureTenantAccess rejects (cross-tenant)', async () => {
    ensureTenantAccessMock.mockRejectedValue(new ServiceError('Access denied: Crew belongs to different tenant', 403));
    const res = await PUT(putReq({ name: 'Renamed' }), params());
    expect(res.status).toBe(403);
    expect(updateCrewMock).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/crews/[id] — tenant check', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireAuthMock.mockResolvedValue({ user: ADMIN, error: null });
    getCrewByIdMock.mockResolvedValue({ id: 'crew-1', site: { tenantId: 'tenant-b' } });
    deleteCrewMock.mockResolvedValue({ ok: true });
  });

  it('checks tenant access against the crew being deleted before deleting', async () => {
    const res = await DELETE(deleteReq(), params());

    expect(res.status).toBe(200);
    expect(ensureTenantAccessMock).toHaveBeenCalledWith(ADMIN, 'tenant-b', 'Crew');
    expect(ensureTenantAccessMock.mock.invocationCallOrder[0])
      .toBeLessThan(deleteCrewMock.mock.invocationCallOrder[0]);
  });

  it('does not call deleteCrew when ensureTenantAccess rejects (cross-tenant)', async () => {
    ensureTenantAccessMock.mockRejectedValue(new ServiceError('Access denied: Crew belongs to different tenant', 403));
    const res = await DELETE(deleteReq(), params());
    expect(res.status).toBe(403);
    expect(deleteCrewMock).not.toHaveBeenCalled();
  });
});
