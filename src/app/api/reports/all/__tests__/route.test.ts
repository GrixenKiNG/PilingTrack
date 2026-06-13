/**
 * GET /api/reports/all — behavioural tests.
 *
 * Cross-user review listing. Pin the authorization boundary (requires
 * reports.read_all → ADMIN/DISPATCHER only) and the delegation to
 * listReportsForReview. Uses the real assertCan so the test tracks the actual
 * ability matrix, not a mock of it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { requireAuthMock, listReviewMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  listReviewMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/modules/reports', () => ({ listReportsForReview: listReviewMock }));

import { GET } from '../route';

function req(qs = ''): NextRequest {
  // _ts bypasses the response cache so each test hits the handler directly.
  return new NextRequest(`http://localhost/api/reports/all?_ts=${Date.now()}${qs ? `&${qs}` : ''}`);
}

describe('GET /api/reports/all', () => {
  beforeEach(() => {
    requireAuthMock.mockReset();
    listReviewMock.mockReset();
  });

  it('returns 401 when there is no session', async () => {
    const authErr = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    requireAuthMock.mockResolvedValue({ user: null, error: authErr });

    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(listReviewMock).not.toHaveBeenCalled();
  });

  it('returns 403 for an OPERATOR (lacks reports.read_all)', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'op', role: 'OPERATOR' }, error: null });

    const res = await GET(req());
    expect(res.status).toBe(403);
    expect(listReviewMock).not.toHaveBeenCalled();
  });

  it('returns paginated reports for an ADMIN and passes siteId/userId filters', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'admin', role: 'ADMIN' }, error: null });
    listReviewMock.mockResolvedValue({ data: [{ reportId: 'r1' }], hasMore: true, nextCursor: 'c1' });

    const res = await GET(req('siteId=site_X&userId=u9&cursor=c0&limit=75'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ reports: [{ reportId: 'r1' }], hasMore: true, nextCursor: 'c1' });

    const [user, siteId, pagination, userId] = listReviewMock.mock.calls[0];
    expect(user).toMatchObject({ id: 'admin' });
    expect(siteId).toBe('site_X');
    expect(pagination).toEqual({ cursor: 'c0', limit: 75 });
    expect(userId).toBe('u9');
  });
});
