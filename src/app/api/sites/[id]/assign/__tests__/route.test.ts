/**
 * POST/DELETE /api/sites/[id]/assign — behavioural tests.
 *
 * Assign/unassign a user to a site. Pins the sites.assign_users boundary, zod
 * validation, the dynamic [id] route param, and delegation to the sites module.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { requireAuthMock, assignMock, unassignMock, invalidateMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  assignMock: vi.fn(),
  unassignMock: vi.fn(),
  invalidateMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/lib/csrf-protection', () => ({ withCsrf: () => null }));
vi.mock('@/modules/sites', () => ({
  assignUserToSite: assignMock,
  unassignUserFromSite: unassignMock,
}));
vi.mock('@/lib/cached-queries', () => ({ invalidateSites: invalidateMock }));

import { POST, DELETE } from '../route';

function post(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/sites/site1/assign', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
function del(qs = ''): NextRequest {
  return new NextRequest(`http://localhost/api/sites/site1/assign${qs ? `?${qs}` : ''}`, { method: 'DELETE' });
}
const ctx = () => ({ params: Promise.resolve({ id: 'site1' }) });
const admin = { user: { id: 'a', role: 'ADMIN', tenantId: 'tenant-a' }, error: null };

describe('POST /api/sites/[id]/assign', () => {
  beforeEach(() => {
    requireAuthMock.mockReset();
    assignMock.mockReset();
  });

  it('returns 403 for an OPERATOR (lacks sites.assign_users)', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'op', role: 'OPERATOR' }, error: null });
    expect((await POST(post({ userId: 'u1', siteId: 'site1' }), ctx())).status).toBe(403);
    expect(assignMock).not.toHaveBeenCalled();
  });

  it('returns 400 when the body fails validation', async () => {
    requireAuthMock.mockResolvedValue(admin);
    expect((await POST(post({}), ctx())).status).toBe(400);
    expect(assignMock).not.toHaveBeenCalled();
  });

  it('assigns the user to the site from the [id] param and invalidates the cache', async () => {
    requireAuthMock.mockResolvedValue(admin);
    assignMock.mockResolvedValue({ id: 'asg-1' });
    invalidateMock.mockReset().mockResolvedValue(undefined);

    const res = await POST(post({ userId: 'u1', siteId: 'site1' }), ctx());
    expect(res.status).toBe(200);
    expect((await res.json()).assignment).toEqual({ id: 'asg-1' });
    expect(assignMock).toHaveBeenCalledWith('site1', 'u1', { tenantId: 'tenant-a', actorId: 'a' });
    expect(invalidateMock).toHaveBeenCalledWith('tenant-a');
  });
});

describe('DELETE /api/sites/[id]/assign', () => {
  beforeEach(() => {
    requireAuthMock.mockReset();
    unassignMock.mockReset();
  });

  it('returns 403 for an OPERATOR', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'op', role: 'OPERATOR' }, error: null });
    expect((await DELETE(del('userId=u9'), ctx())).status).toBe(403);
    expect(unassignMock).not.toHaveBeenCalled();
  });

  it('unassigns the user from the site and invalidates the cache', async () => {
    requireAuthMock.mockResolvedValue(admin);
    unassignMock.mockResolvedValue({ removed: true });
    invalidateMock.mockReset().mockResolvedValue(undefined);

    const res = await DELETE(del('userId=u9'), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removed: true });
    expect(unassignMock).toHaveBeenCalledWith('site1', 'u9', { tenantId: 'tenant-a', actorId: 'a' });
    expect(invalidateMock).toHaveBeenCalledWith('tenant-a');
  });
});
