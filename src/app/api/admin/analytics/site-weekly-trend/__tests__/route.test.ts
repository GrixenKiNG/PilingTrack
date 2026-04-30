/**
 * GET /api/admin/analytics/site-weekly-trend — behavioural tests.
 *
 *   - 401 without auth
 *   - weeks param clamped to [1, 52]
 *   - siteId='all' or missing → no siteId filter; concrete value → filter
 *   - rows ordered by weekStart desc (newest first)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { requireAuthMock, findManyMock, assertCanMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  findManyMock: vi.fn() as ReturnType<typeof vi.fn>,
  assertCanMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/services/auth/authorization-service', async () => {
  const actual = await vi.importActual<object>('@/services/auth/authorization-service');
  return { ...actual, assertCan: assertCanMock };
});
vi.mock('@/lib/db', () => ({
  db: { siteWeeklyTrend: { findMany: findManyMock } },
}));

import { GET } from '../route';

function req(qs: string): NextRequest {
  return new NextRequest(`http://localhost/api/admin/analytics/site-weekly-trend?${qs}`);
}

describe('GET /api/admin/analytics/site-weekly-trend', () => {
  beforeEach(() => {
    requireAuthMock.mockReset();
    findManyMock.mockReset();
    findManyMock.mockResolvedValue([]);
    assertCanMock.mockReset();
  });

  it('returns the auth error from requireAuth without hitting DB', async () => {
    const authErr = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    requireAuthMock.mockResolvedValue({ user: null, error: authErr });
    const res = await GET(req('weeks=8'));
    expect(res.status).toBe(401);
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it('clamps weeks to [1, 52]', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'a', role: 'ADMIN' }, error: null });

    await GET(req('weeks=999'));
    // No siteId → take = weeks * 10 (cross-site rows). Clamped weeks = 52.
    expect(findManyMock.mock.calls[0][0].take).toBe(52 * 10);

    findManyMock.mockClear();
    await GET(req('weeks=0'));
    expect(findManyMock.mock.calls[0][0].take).toBe(1 * 10);

    findManyMock.mockClear();
    await GET(req('weeks=8&siteId=site_A'));
    // Concrete siteId → take = weeks * 1.
    expect(findManyMock.mock.calls[0][0].take).toBe(8);
  });

  it('orders rows by weekStart desc and applies siteId filter only when concrete', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'a', role: 'ADMIN' }, error: null });

    await GET(req('weeks=4&siteId=all'));
    expect(findManyMock.mock.calls[0][0]).toMatchObject({
      where: {},
      orderBy: { weekStart: 'desc' },
    });

    findManyMock.mockClear();
    await GET(req('weeks=4&siteId=site_X'));
    expect(findManyMock.mock.calls[0][0]).toMatchObject({
      where: { siteId: 'site_X' },
      orderBy: { weekStart: 'desc' },
    });
  });
});
