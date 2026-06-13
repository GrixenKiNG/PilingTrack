/**
 * GET /api/reports/period — handler behavioural tests.
 *
 * (The pure aggregation `computePeriodSummary` is covered separately in
 * period-summary.test.ts; this pins the route: auth, the reports.read_all
 * boundary, tenant isolation, and the SitePilePlan meter lookup.)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { requireAuthMock, getByPeriodMock, findManyMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  getByPeriodMock: vi.fn(),
  findManyMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/modules/reports/application/queries/report-query.service', () => ({
  getReportsByPeriod: getByPeriodMock,
}));
vi.mock('@/lib/db', () => ({ db: { sitePilePlan: { findMany: findManyMock } } }));

import { GET } from '../route';

function req(qs: string): NextRequest {
  return new NextRequest(`http://localhost/api/reports/period?${qs}`);
}

describe('GET /api/reports/period', () => {
  beforeEach(() => {
    requireAuthMock.mockReset();
    getByPeriodMock.mockReset();
    findManyMock.mockReset();
  });

  it('returns 401 when there is no session', async () => {
    const authErr = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    requireAuthMock.mockResolvedValue({ user: null, error: authErr });

    const res = await GET(req('dateFrom=2026-04-01&dateTo=2026-04-30'));
    expect(res.status).toBe(401);
    expect(getByPeriodMock).not.toHaveBeenCalled();
  });

  it('returns 403 for an OPERATOR (lacks reports.read_all)', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'op', role: 'OPERATOR' }, error: null });

    const res = await GET(req('dateFrom=2026-04-01&dateTo=2026-04-30'));
    expect(res.status).toBe(403);
    expect(getByPeriodMock).not.toHaveBeenCalled();
  });

  it('scopes the query to the caller tenant and returns the period summary', async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: 'admin', role: 'ADMIN', tenantId: 'orion' },
      error: null,
    });
    getByPeriodMock.mockResolvedValue([
      { siteId: 's1', userId: 'u1', piles: [{ count: 2, pileGradeId: 'g1' }], drillings: [], downtimes: [] },
    ]);
    findManyMock.mockResolvedValue([{ siteId: 's1', pileGradeId: 'g1', metersPerUnit: 5 }]);

    const res = await GET(req('dateFrom=2026-04-01&dateTo=2026-04-30&siteId=s1&userId=u1'));
    expect(res.status).toBe(200);
    const body = await res.json();

    // Tenant isolation: the caller's tenantId must reach the query.
    expect(getByPeriodMock).toHaveBeenCalledWith('2026-04-01', '2026-04-30', 's1', 'orion', 'u1');
    // Meters resolved from the SitePilePlan lookup (2 piles × 5 m).
    expect(body.summary).toMatchObject({ totalPiles: 2, totalPileMeters: 10, reportCount: 1 });
  });

  it('skips the SitePilePlan lookup when no reports have piles', async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: 'admin', role: 'ADMIN', tenantId: 'orion' },
      error: null,
    });
    getByPeriodMock.mockResolvedValue([
      { siteId: 's1', userId: 'u1', piles: [], drillings: [{ count: 1, meters: 10 }], downtimes: [] },
    ]);

    const res = await GET(req('dateFrom=2026-04-01&dateTo=2026-04-30'));
    expect(res.status).toBe(200);
    expect(findManyMock).not.toHaveBeenCalled();
    expect((await res.json()).summary).toMatchObject({ totalPiles: 0, totalDrilling: 10 });
  });
});
