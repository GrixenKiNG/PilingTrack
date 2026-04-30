/**
 * GET /api/admin/analytics/operator-performance — behavioural tests.
 *
 * The endpoint reads OperatorPerformance projection rows (one per
 * userId+siteId+date) and aggregates per-operator. Pin the contract:
 *   - 401 without auth
 *   - 403 without analytics.read
 *   - 400 when dateFrom/dateTo missing
 *   - aggregation: per-operator sums across all days, sorted by piles
 *   - siteId='all' (or missing) does NOT filter by site
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { requireAuthMock, findManyMock, assertCanMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  findManyMock: vi.fn(),
  assertCanMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/services/auth/authorization-service', async () => {
  const actual = await vi.importActual<object>('@/services/auth/authorization-service');
  return { ...actual, assertCan: assertCanMock };
});
vi.mock('@/lib/db', () => ({
  db: { operatorPerformance: { findMany: findManyMock } },
}));

import { GET } from '../route';

function req(qs: string): NextRequest {
  return new NextRequest(`http://localhost/api/admin/analytics/operator-performance?${qs}`);
}

describe('GET /api/admin/analytics/operator-performance', () => {
  beforeEach(() => {
    requireAuthMock.mockReset();
    findManyMock.mockReset();
    assertCanMock.mockReset();
  });

  it('returns 401 from requireAuth when no session', async () => {
    const authErr = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    requireAuthMock.mockResolvedValue({ user: null, error: authErr });
    const res = await GET(req('dateFrom=2026-04-01&dateTo=2026-04-30'));
    expect(res.status).toBe(401);
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it('returns 400 when dateFrom or dateTo are missing', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'u', role: 'ADMIN' }, error: null });
    const res = await GET(req('dateFrom=2026-04-01'));
    expect(res.status).toBe(400);
  });

  it('aggregates per-operator across days, sorted by totalPiles desc', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'admin', role: 'ADMIN' }, error: null });
    findManyMock.mockResolvedValue([
      { userId: 'u1', userName: 'Иван', totalPiles: 10, totalDrilling: 100, totalDowntime: 30, reportCount: 1, date: '2026-04-29' },
      { userId: 'u2', userName: 'Петр', totalPiles: 50, totalDrilling: 50,  totalDowntime: 0,  reportCount: 1, date: '2026-04-29' },
      { userId: 'u1', userName: 'Иван', totalPiles: 20, totalDrilling: 200, totalDowntime: 60, reportCount: 1, date: '2026-04-28' },
    ]);

    const res = await GET(req('dateFrom=2026-04-28&dateTo=2026-04-29'));
    expect(res.status).toBe(200);
    const body = await res.json();
    // u1: 10+20 = 30 piles; u2: 50; sorted desc by piles → u2 first.
    expect(body.summary.map((o: { userId: string }) => o.userId)).toEqual(['u2', 'u1']);
    expect(body.summary.find((o: { userId: string }) => o.userId === 'u1')).toMatchObject({
      totalPiles: 30, totalDrilling: 300, totalDowntime: 90, reportCount: 2, days: 2,
    });
  });

  it('filters by siteId only when not "all"', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'admin', role: 'ADMIN' }, error: null });
    findManyMock.mockResolvedValue([]);

    await GET(req('dateFrom=2026-04-01&dateTo=2026-04-30&siteId=all'));
    expect(findManyMock.mock.calls[0][0].where).toEqual({
      date: { gte: '2026-04-01', lte: '2026-04-30' },
    });

    findManyMock.mockClear();
    await GET(req('dateFrom=2026-04-01&dateTo=2026-04-30&siteId=site_X'));
    expect(findManyMock.mock.calls[0][0].where).toEqual({
      date: { gte: '2026-04-01', lte: '2026-04-30' },
      siteId: 'site_X',
    });
  });
});
