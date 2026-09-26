/**
 * recomputeSiteDailySummary — regression test for C-1.
 *
 * History (2026-04): SiteDailySummary used to be maintained incrementally
 * from item-level events (PILE_WORK_ADDED / DRILLING_ADDED / DOWNTIME_ADDED)
 * with two bugs:
 *   1. `siteId || ''` fallback wrote rows with empty key.
 *   2. reportCount += 1 on every work item — one report with 5 piles + 3
 *      drillings counted as 8 reports.
 *
 * Replaced with REPORT_SUBMITTED / REPORT_UPDATED → recompute aggregate
 * from db.report.findMany. These tests pin the new contract.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findManyMock, upsertMock, deleteManyMock, findUniqueMock, analyticsUpsertMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  upsertMock: vi.fn(),
  deleteManyMock: vi.fn(),
  findUniqueMock: vi.fn(),
  analyticsUpsertMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    report: { findMany: findManyMock, findUnique: findUniqueMock },
    siteDailySummary: { upsert: upsertMock, deleteMany: deleteManyMock },
    reportAnalytics: { upsert: analyticsUpsertMock },
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { recomputeSiteDailySummary, registerAnalyticsEventHandler } from '../event-handlers';
import { emitDomainEvent } from '@/services/reports/domain-events';
import { REPORT_DOMAIN_EVENT_TYPES } from '@/modules/reports/domain';

describe('handleReportForAnalytics', () => {
  beforeEach(() => {
    findManyMock.mockReset();
    upsertMock.mockReset();
    deleteManyMock.mockReset();
    findUniqueMock.mockReset();
    analyticsUpsertMock.mockReset();
    findManyMock.mockResolvedValue([]);
    registerAnalyticsEventHandler();
  });

  it('writes the projection with the tenant of the event', async () => {
    await emitDomainEvent({
      id: 'evt-1',
      type: REPORT_DOMAIN_EVENT_TYPES.REPORT_SUBMITTED,
      aggregateId: 'report-uuid-1',
      aggregateType: 'Report',
      occurredAt: new Date().toISOString(),
      siteId: 'site_A',
      userId: 'user-1',
      tenantId: 'tenant-a',
      data: {},
    });

    expect(analyticsUpsertMock.mock.calls[0][0].create).toMatchObject({ tenantId: 'tenant-a' });
  });

  /*
    Проекция без организации раньше писалась с `tenantId: null`: строка
    становилась невидимой для всех тенантных запросов (сломанная аналитика),
    а для запроса с пустым тенантом — видна всем организациям. Запись без
    организации не создаём и сообщаем в лог, как для siteId/userId.
  */
  it('пропускает проекцию, когда организацию определить нечем', async () => {
    findUniqueMock.mockResolvedValue({ siteId: 'site_A', userId: 'user-1', tenantId: null });

    await emitDomainEvent({
      id: 'evt-2',
      type: REPORT_DOMAIN_EVENT_TYPES.REPORT_SUBMITTED,
      aggregateId: 'report-uuid-2',
      aggregateType: 'Report',
      occurredAt: new Date().toISOString(),
      siteId: 'site_A',
      userId: 'user-1',
      data: {},
    });

    expect(analyticsUpsertMock).not.toHaveBeenCalled();
  });
});

describe('recomputeSiteDailySummary', () => {
  beforeEach(() => {
    findManyMock.mockReset();
    upsertMock.mockReset();
    deleteManyMock.mockReset();
    findUniqueMock.mockReset();
    analyticsUpsertMock.mockReset();
  });

  it('aggregates totals across ALL reports for a (siteId, date) pair', async () => {
    findManyMock.mockResolvedValue([
      {
        piles: [{ count: 10 }, { count: 5 }],
        drillings: [{ meters: 100 }],
        downtimes: [{ duration: 30 }],
      },
      {
        piles: [{ count: 3 }],
        drillings: [{ meters: 50 }, { meters: 25 }],
        downtimes: [],
      },
    ]);

    await recomputeSiteDailySummary('site_A', '2026-04-30');

    expect(upsertMock).toHaveBeenCalledTimes(1);
    const args = upsertMock.mock.calls[0][0];
    expect(args.where).toEqual({ siteId_date: { siteId: 'site_A', date: '2026-04-30' } });
    // 10 + 5 + 3 = 18 piles, 100 + 50 + 25 = 175 m drilling, 30 m downtime,
    // and reportCount = 2 (NOT 8 — the bug it replaces)
    expect(args.create).toMatchObject({
      siteId: 'site_A', date: '2026-04-30',
      totalPiles: 18, totalDrilling: 175, totalDowntime: 30, reportCount: 2,
    });
    expect(args.update).toMatchObject({
      totalPiles: 18, totalDrilling: 175, totalDowntime: 30, reportCount: 2,
    });
  });

  it('deletes the row when no reports remain for that (siteId, date)', async () => {
    // Last report on the day was deleted — phantom zero rows would clutter
    // the admin daily chart, so wipe the row instead.
    findManyMock.mockResolvedValue([]);

    await recomputeSiteDailySummary('site_A', '2026-04-30');

    expect(upsertMock).not.toHaveBeenCalled();
    expect(deleteManyMock).toHaveBeenCalledWith({
      where: { siteId: 'site_A', date: '2026-04-30' },
    });
  });

  it('handles reports with empty piles/drillings/downtimes arrays', async () => {
    findManyMock.mockResolvedValue([{ piles: [], drillings: [], downtimes: [] }]);

    await recomputeSiteDailySummary('site_A', '2026-04-30');

    const args = upsertMock.mock.calls[0][0];
    expect(args.create).toMatchObject({
      totalPiles: 0, totalDrilling: 0, totalDowntime: 0, reportCount: 1,
    });
  });
});
