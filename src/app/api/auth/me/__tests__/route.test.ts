/**
 * GET /api/auth/me — behavioural tests.
 *
 * Critical hot path: every authenticated page hits this. Cover:
 *   - 401 when no session
 *   - 200 with user fields when authenticated
 *   - 404 when DB row vanished (rare but happens after admin deletes)
 *   - cross-user scope: admin can read other user's profile via ?userId
 *   - cross-TENANT scope: a foreign-tenant row reads as 404, never as data
 *
 * The tenant guard here is deliberately a second layer: RLS already filters
 * the row out in production (policy `tenant_isolation_user`). It is repeated
 * in the application because this route selects by primary key alone, so a
 * lost `app.current_tenant` GUC would otherwise have nothing under it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { requireAuthMock, resolveScopeMock, findUniqueMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  resolveScopeMock: vi.fn(),
  findUniqueMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
// Only the scope resolver is stubbed; `ensureTenantAccess` stays real so the
// test exercises the actual guard rather than a restatement of it.
vi.mock('@/services/auth/resource-access-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/auth/resource-access-service')>()),
  resolveAccessibleUserId: resolveScopeMock,
}));
vi.mock('@/lib/db', () => ({ db: { user: { findUnique: findUniqueMock } } }));
vi.mock('@/lib/csrf-protection', () => ({ withCsrf: () => null }));

import { GET } from '../route';

function req(url = 'http://localhost/api/auth/me'): NextRequest {
  return new NextRequest(url);
}

describe('GET /api/auth/me', () => {
  beforeEach(() => {
    requireAuthMock.mockReset();
    resolveScopeMock.mockReset();
    findUniqueMock.mockReset();
  });

  it('returns the user fields for the authenticated session', async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: 'u1', role: 'OPERATOR', tenantId: 'orion' }, error: null,
    });
    resolveScopeMock.mockReturnValue('u1');
    findUniqueMock.mockResolvedValue({
      id: 'u1', email: 'op@piling.ru', name: 'Op', role: 'OPERATOR', isActive: true,
      tenantId: 'orion',
    });

    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toEqual({
      id: 'u1', email: 'op@piling.ru', name: 'Op', role: 'OPERATOR', isActive: true,
    });
    // The select clause is the security boundary — passwordHash etc. must not
    // leak. `tenantId` is fetched for the guard but must not reach the client.
    expect(findUniqueMock.mock.calls[0][0].select).toEqual({
      id: true, email: true, name: true, role: true, isActive: true, tenantId: true,
    });
  });

  it('propagates the auth-failure response from requireAuth', async () => {
    const authErr = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    requireAuthMock.mockResolvedValue({ user: null, error: authErr });

    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the session user no longer exists in DB', async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: 'u1', role: 'ADMIN', tenantId: 'orion' }, error: null,
    });
    resolveScopeMock.mockReturnValue('u1');
    findUniqueMock.mockResolvedValue(null);

    const res = await GET(req());
    expect(res.status).toBe(404);
  });

  it('admin reading another user via ?userId resolves through resolveAccessibleUserId', async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: 'admin-1', role: 'ADMIN', tenantId: 'orion' }, error: null,
    });
    resolveScopeMock.mockReturnValue('target-2');
    findUniqueMock.mockResolvedValue({
      id: 'target-2', email: 't@p.ru', name: 'T', role: 'OPERATOR', isActive: true,
      tenantId: 'orion',
    });

    const res = await GET(req('http://localhost/api/auth/me?userId=target-2'));
    expect(res.status).toBe(200);
    expect(resolveScopeMock).toHaveBeenCalledWith(
      { id: 'admin-1', role: 'ADMIN', tenantId: 'orion' }, 'target-2', 'reports.read_cross_user',
    );
    expect(findUniqueMock.mock.calls[0][0].where).toEqual({ id: 'target-2' });
  });

  it('returns 404 — not the row — when the target user is in another tenant', async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: 'admin-1', role: 'ADMIN', tenantId: 'orion' }, error: null,
    });
    resolveScopeMock.mockReturnValue('foreign-9');
    findUniqueMock.mockResolvedValue({
      id: 'foreign-9', email: 'spy@other.ru', name: 'Foreign', role: 'ADMIN',
      isActive: true, tenantId: 'other-tenant',
    });

    const res = await GET(req('http://localhost/api/auth/me?userId=foreign-9'));
    expect(res.status).toBe(404);
    // Same shape as a missing row: existence of the id must not be inferable.
    expect(JSON.stringify(await res.json())).not.toContain('spy@other.ru');
  });

  it('refuses a session with no tenant context at all', async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: 'u1', role: 'ADMIN', tenantId: null }, error: null,
    });
    resolveScopeMock.mockReturnValue('u1');
    findUniqueMock.mockResolvedValue({
      id: 'u1', email: 'a@p.ru', name: 'A', role: 'ADMIN', isActive: true, tenantId: 'orion',
    });

    const res = await GET(req());
    expect(res.status).toBe(403);
  });
});
