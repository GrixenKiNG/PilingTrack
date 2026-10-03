import { describe, it, expect, vi } from 'vitest';
const { reportFindMany, createMany, deleteMany, analyticsUpsert } = vi.hoisted(() => ({
  reportFindMany: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn(), analyticsUpsert: vi.fn(),
}));
vi.mock('@/lib/tenant-iteration', () => ({ forEachTenant: async (fn: (tenantId: string) => Promise<number>) => [await fn('orion')] }));
vi.mock('@/lib/db', () => {
  const client = { report: { findMany: reportFindMany }, site: { findMany: vi.fn(async () => [{ id: 's1' }]) },
    siteDailySummary: { deleteMany, createMany }, reportAnalytics: { upsert: analyticsUpsert },
    $transaction: async (fn: (tx: unknown) => unknown): Promise<unknown> => fn(client) };
  return { db: client };
});
import { rebuildSiteDailySummary, rebuildReportAnalytics } from '../rebuild';
describe('I05 rebuild policy', () => {
  it('daily rebuild skips draft work and includes it after submission', async () => {
    const report = { reportId: 'r1', tenantId: 'orion', siteId: 's1', userId: 'u1', date: '2026-10-02', status: 'draft', updatedAt: new Date(),
      piles: [{ count: 2 }], drillings: [{ meters: 18 }], downtimes: [{ duration: 1.5 }] };
    reportFindMany.mockImplementation(async ({ where }) => !where.status || report.status === where.status ? [report] : []);
    createMany.mockReset(); analyticsUpsert.mockReset();
    expect((await rebuildSiteDailySummary()).rowsWritten).toBe(0);
    expect(createMany).toHaveBeenLastCalledWith({ data: [] });
    await rebuildReportAnalytics();
    // Raw per-report history retains its labelled draft; aggregate KPI does not.
    expect(analyticsUpsert.mock.calls[0][0].create).toMatchObject({ status: 'draft', totalPiles: 2 });
    report.status = 'submitted';
    expect((await rebuildSiteDailySummary()).rowsWritten).toBe(1);
    expect(createMany.mock.calls[1][0].data[0]).toMatchObject({ reportCount: 1, totalPiles: 2, totalDrilling: 18, totalDowntime: 1.5 });
  });
});
