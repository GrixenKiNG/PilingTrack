/**
 * GET /api/reports/period — handler behavioural tests.
 *
 * (The pure aggregation `computePeriodSummary` is covered separately in
 * period-summary.test.ts; this pins the route: auth, the reports.read_all
 * boundary and tenant isolation. Pile metres come from PileGrade.lengthMm on
 * each pile row — no SitePilePlan lookup.)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { requireAuthMock, getByPeriodMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  getByPeriodMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/modules/reports/application/queries/report-query.service', () => ({
  getReportsByPeriod: getByPeriodMock,
}));

import { GET } from '../route';

function req(qs: string): NextRequest {
  return new NextRequest(`http://localhost/api/reports/period?${qs}`);
}

describe('GET /api/reports/period', () => {
  beforeEach(() => {
    requireAuthMock.mockReset();
    getByPeriodMock.mockReset();
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

  it('scopes the query to the caller tenant and sums metres from grade length', async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: 'admin', role: 'ADMIN', tenantId: 'orion' },
      error: null,
    });
    getByPeriodMock.mockResolvedValue([
      { siteId: 's1', userId: 'u1', piles: [{ count: 2, pileGradeId: 'g1', pileGrade: { lengthMm: 5000 } }], drillings: [], downtimes: [] },
    ]);

    const res = await GET(req('dateFrom=2026-04-01&dateTo=2026-04-30&siteId=s1&userId=u1'));
    expect(res.status).toBe(200);
    const body = await res.json();

    // Tenant isolation: the caller's tenantId must reach the query.
    expect(getByPeriodMock).toHaveBeenCalledWith('2026-04-01', '2026-04-30', 's1', 'orion', 'u1');
    // Metres from the grade length (2 piles × 5 m), no plan lookup.
    expect(body.summary).toMatchObject({ totalPiles: 2, totalPileMeters: 10, reportCount: 1 });
  });
});
