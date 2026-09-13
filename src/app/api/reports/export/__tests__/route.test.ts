/**
 * GET /api/reports/export — handler behavioural tests.
 *
 * Regression: the route called exportReportsCsv without a tenantId, so any
 * ADMIN (reports.export is ADMIN-only) could download every tenant's report
 * rows as CSV. Pins that the route fails closed when no tenant can be
 * resolved, and that the resolved tenantId reaches the query — same pattern
 * as src/app/api/reports/period/__tests__/route.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { requireAuthMock, exportReportsCsvMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  exportReportsCsvMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/modules/reports', () => ({ exportReportsCsv: exportReportsCsvMock }));

import { GET } from '../route';

function req(qs: string): NextRequest {
  return new NextRequest(`http://localhost/api/reports/export?${qs}`);
}

describe('GET /api/reports/export', () => {
  beforeEach(() => {
    requireAuthMock.mockReset();
    exportReportsCsvMock.mockReset();
    exportReportsCsvMock.mockResolvedValue('id;date\n');
  });

  it('returns 401 when there is no session', async () => {
    const authErr = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    requireAuthMock.mockResolvedValue({ user: null, error: authErr });

    const res = await GET(req('dateFrom=2026-04-01&dateTo=2026-04-30'));
    expect(res.status).toBe(401);
    expect(exportReportsCsvMock).not.toHaveBeenCalled();
  });

  it('refuses when no tenantId can be resolved (fail closed)', async () => {
    const prevDefault = process.env.DEFAULT_TENANT_ID;
    delete process.env.DEFAULT_TENANT_ID;
    requireAuthMock.mockResolvedValue({
      user: { id: 'admin', role: 'ADMIN', tenantId: null },
      error: null,
    });

    const res = await GET(req('dateFrom=2026-04-01&dateTo=2026-04-30'));
    // 403, not 400: requireTenantId throws instead of returning null, so the
    // route's own `if (!tenantId)` branch below it is never reached. What this
    // test pins is that the refusal happens at all and the export never runs.
    expect(res.status).toBe(403);
    expect(exportReportsCsvMock).not.toHaveBeenCalled();

    if (prevDefault === undefined) delete process.env.DEFAULT_TENANT_ID;
    else process.env.DEFAULT_TENANT_ID = prevDefault;
  });

  it('scopes the export to the caller tenant', async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: 'admin', role: 'ADMIN', tenantId: 'orion' },
      error: null,
    });

    const res = await GET(req('dateFrom=2026-04-01&dateTo=2026-04-30&siteId=s1'));
    expect(res.status).toBe(200);

    // Tenant isolation: the caller's tenantId must reach the query.
    expect(exportReportsCsvMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'orion', siteId: 's1' })
    );
  });
});
