/**
 * GET /api/reports/my — behavioural tests.
 *
 * Returns the caller's own reports (or a requested user's, scope-checked in the
 * module). Pin the contract: 401 without auth, and a happy path that delegates
 * to listReportsForUserScope with the session user + requested userId.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { requireAuthMock, listScopeMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  listScopeMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/modules/reports', () => ({ listReportsForUserScope: listScopeMock }));

import { GET } from '../route';

function req(qs = ''): NextRequest {
  return new NextRequest(`http://localhost/api/reports/my${qs ? `?${qs}` : ''}`);
}

describe('GET /api/reports/my', () => {
  beforeEach(() => {
    requireAuthMock.mockReset();
    listScopeMock.mockReset();
  });

  it('returns the auth error when there is no session', async () => {
    const authErr = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    requireAuthMock.mockResolvedValue({ user: null, error: authErr });

    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(listScopeMock).not.toHaveBeenCalled();
  });

  it('delegates to listReportsForUserScope with the session user and requested userId', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'u1', role: 'OPERATOR' }, error: null });
    listScopeMock.mockResolvedValue([{ reportId: 'r1' }]);

    const res = await GET(req('userId=u2'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reports).toEqual([{ reportId: 'r1' }]);
    expect(body.data).toEqual([{ reportId: 'r1' }]);

    const [user, requestedUserId] = listScopeMock.mock.calls[0];
    expect(user).toMatchObject({ id: 'u1' });
    expect(requestedUserId).toBe('u2');
  });
});
