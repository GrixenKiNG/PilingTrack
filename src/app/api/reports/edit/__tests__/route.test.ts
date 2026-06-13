/**
 * GET /api/reports/edit — behavioural tests.
 *
 * Fetches the editable report for a user/site/date (read, despite the name).
 * Pin: 401 without auth, and delegation to getEditableReport with the resolved
 * parameters (null-coalesced response shape).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { requireAuthMock, getEditableMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  getEditableMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/modules/reports/application/queries/report-query.service', () => ({
  getEditableReport: getEditableMock,
}));

import { GET } from '../route';

function req(qs = ''): NextRequest {
  return new NextRequest(`http://localhost/api/reports/edit${qs ? `?${qs}` : ''}`);
}

describe('GET /api/reports/edit', () => {
  beforeEach(() => {
    requireAuthMock.mockReset();
    getEditableMock.mockReset();
  });

  it('returns 401 when there is no session', async () => {
    const authErr = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    requireAuthMock.mockResolvedValue({ user: null, error: authErr });

    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(getEditableMock).not.toHaveBeenCalled();
  });

  it('delegates to getEditableReport with userId/siteId/date and returns the report', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'u1', role: 'OPERATOR' }, error: null });
    getEditableMock.mockResolvedValue({ reportId: 'r1' });

    const res = await GET(req('userId=u1&siteId=s1&date=2026-04-05'));
    expect(res.status).toBe(200);
    expect((await res.json()).report).toEqual({ reportId: 'r1' });

    const [user, userId, siteId, date] = getEditableMock.mock.calls[0];
    expect(user).toMatchObject({ id: 'u1' });
    expect(userId).toBe('u1');
    expect(siteId).toBe('s1');
    expect(date).toBe('2026-04-05');
  });

  it('returns null when no editable report exists', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'u1', role: 'OPERATOR' }, error: null });
    getEditableMock.mockResolvedValue(null);

    const res = await GET(req('date=2026-04-05'));
    expect(res.status).toBe(200);
    expect((await res.json()).report).toBeNull();
  });
});
