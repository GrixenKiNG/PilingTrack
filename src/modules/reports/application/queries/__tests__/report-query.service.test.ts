/**
 * Regression: exportReportsCsv built its `where` clause from siteId/date
 * filters only — no tenantId — so any ADMIN (reports.export is ADMIN-only)
 * could download every tenant's report rows via GET /api/reports/export.
 * Same bug class as the IS-NULL-OR-tenantId IDOR (CLAUDE.md); fix is fail
 * closed + strict tenantId equality, mirroring getSiteAnalytics.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock('@/lib/db', () => ({ db: { report: { findMany } } }));

import { exportReportsCsv, listReportsForReview } from '../report-query.service';

describe('exportReportsCsv — tenant isolation', () => {
  beforeEach(() => {
    findMany.mockReset();
    findMany.mockResolvedValue([]);
  });

  it('throws when tenantId is missing (fail closed)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test: exercising the missing-tenantId guard
    await expect(exportReportsCsv({} as any)).rejects.toThrow('tenantId');
    expect(findMany).not.toHaveBeenCalled();
  });

  it('scopes the query to the caller tenant with strict equality', async () => {
    await exportReportsCsv({ tenantId: 'orion', siteId: 's1', dateFrom: '2026-01-01', dateTo: '2026-01-31' });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'orion', siteId: 's1' }),
      })
    );
  });
});

// R26-2: для не-платформенной роли без организации фильтр молча не ставился —
// то есть «все отчёты всех организаций». ADMIN/DISPATCHER видят все организации
// по решению владельца (AGENTS.md) и под правило не попадают.
describe('listReportsForReview — tenant isolation', () => {
  it('refuses an operator without a tenant instead of listing every tenant', async () => {
    findMany.mockReset();
    await expect(listReportsForReview({ id: 'u1', role: 'OPERATOR', tenantId: null })).rejects.toThrow(/организац/);
    expect(findMany).not.toHaveBeenCalled();
  });
});
