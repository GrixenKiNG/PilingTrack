/**
 * PUT /api/users/manage — behavioural tests (withMutation path).
 *
 * Pins: the users.manage boundary (ADMIN-only), zod validation (id required),
 * and the update path delegating to updateUser with the actor id.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { requireAuthMock, updateUserMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  updateUserMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/lib/csrf-protection', () => ({ withCsrf: () => null }));
vi.mock('@/modules/users', () => ({ updateUser: updateUserMock }));

import { PUT } from '../route';

function req(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/users/manage', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PUT /api/users/manage', () => {
  beforeEach(() => {
    requireAuthMock.mockReset();
    updateUserMock.mockReset();
  });

  it('returns 401 when there is no session', async () => {
    requireAuthMock.mockResolvedValue({ user: null, error: new Response(null, { status: 401 }) });
    const res = await PUT(req({ id: 'u1' }));
    expect(res.status).toBe(401);
  });

  it('returns 403 for a DISPATCHER (users.manage is ADMIN-only)', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'd', role: 'DISPATCHER' }, error: null });
    const res = await PUT(req({ id: 'u1', name: 'New' }));
    expect(res.status).toBe(403);
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it('returns 400 when id is missing', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'a', role: 'ADMIN', tenantId: 'tenant-a' }, error: null });
    const res = await PUT(req({ name: 'New' }));
    expect(res.status).toBe(400);
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it('fails closed when the authenticated admin has no tenant', async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: 'a', role: 'ADMIN', tenantId: null },
      error: null,
    });

    const res = await PUT(req({ id: 'u1', name: 'New' }));

    expect(res.status).toBe(400);
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it('updates the user and returns the sanitised record with the actor id', async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: 'admin-1', role: 'ADMIN', tenantId: 'tenant-a' },
      error: null,
    });
    updateUserMock.mockResolvedValue({
      id: 'u1', isActive: true, name: 'New', role: 'OPERATOR', phone: null,
    });

    const res = await PUT(req({
      id: 'u1',
      name: 'New',
      role: 'OPERATOR',
      tenantId: 'tenant-b',
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.user).toMatchObject({ id: 'u1', name: 'New', role: 'OPERATOR' });
    expect(updateUserMock).toHaveBeenCalledWith(
      'tenant-a',
      expect.not.objectContaining({ tenantId: expect.anything() }),
      'admin-1'
    );
  });

  it('passes a valid PIN to the user service', async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: 'admin-1', role: 'ADMIN', tenantId: 'tenant-a' },
      error: null,
    });
    updateUserMock.mockResolvedValue({
      id: 'u1', isActive: true, name: 'User', role: 'OPERATOR', phone: null,
    });

    const res = await PUT(req({ id: 'u1', pin: '5678' }));

    expect(res.status).toBe(200);
    expect(updateUserMock).toHaveBeenCalledWith(
      'tenant-a',
      expect.objectContaining({ id: 'u1', pin: '5678' }),
      'admin-1'
    );
  });
});
