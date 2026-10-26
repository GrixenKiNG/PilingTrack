import {beforeEach, describe, expect, it, vi} from 'vitest';

/*
  Пересборка проекций: недельный тренд и полный прогон.

  Держится:
  - неделя считается от понедельника (воскресенье относится к прошлой неделе);
  - организация строки берётся с объекта, при его отсутствии — из текущей;
  - очистка и запись идут одной транзакцией и только по своей организации,
    иначе сбой вставки оставил бы тренд пустым до следующего прогона;
  - полный прогон идёт в порядке «отчёты → сутки → недели»: недели читают сутки;
  - отчёт без объекта или работника в аналитику не попадает.
*/
const h = vi.hoisted(() => ({
  siteFindMany: vi.fn(),
  dailyFindMany: vi.fn(),
  weeklyDelete: vi.fn(),
  weeklyCreate: vi.fn(),
  dailyDelete: vi.fn(),
  dailyCreate: vi.fn(),
  reportFindMany: vi.fn(),
  analyticsUpsert: vi.fn(),
  order: [] as string[],
}));

vi.mock('@/lib/tenant-iteration', () => ({
  forEachTenant: async (work: (tenantId: string) => Promise<number>) => [await work('tenant-a')],
}));
vi.mock('@/lib/db', () => {
  const client = {
    site: {findMany: h.siteFindMany},
    siteDailySummary: {findMany: h.dailyFindMany, deleteMany: h.dailyDelete, createMany: h.dailyCreate},
    siteWeeklyTrend: {deleteMany: h.weeklyDelete, createMany: h.weeklyCreate},
    report: {findMany: h.reportFindMany},
    reportAnalytics: {upsert: h.analyticsUpsert},
    $transaction: async (work: (tx: unknown) => unknown) => work(client),
  };
  return {db: client};
});

import {rebuildAll, rebuildReportAnalytics, rebuildSiteWeeklyTrend} from '../rebuild';

const day = (siteId: string, date: string, piles: number, drilling = 0, downtime = 0, reports = 1) => ({
  siteId, date, totalPiles: piles, totalDrilling: drilling, totalDowntime: downtime, reportCount: reports,
});

beforeEach(() => {
  vi.clearAllMocks();
  h.order.length = 0;
  h.siteFindMany.mockResolvedValue([{id: 's1', tenantId: 'tenant-a'}]);
  h.dailyFindMany.mockResolvedValue([]);
  h.reportFindMany.mockResolvedValue([]);
});

describe('rebuildSiteWeeklyTrend', () => {
  it('складывает сутки по неделям от понедельника: воскресенье — в прошлую неделю', async () => {
    h.dailyFindMany.mockResolvedValue([
      day('s1', '2026-10-19', 10, 1, 0.5), // понедельник
      day('s1', '2026-10-25', 5, 2, 1, 2), // воскресенье той же недели
      day('s1', '2026-10-26', 7), // понедельник следующей
    ]);

    const result = await rebuildSiteWeeklyTrend();

    expect(result).toMatchObject({name: 'site-weekly', rowsWritten: 2});
    const rows = h.weeklyCreate.mock.calls[0][0].data;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      siteId: 's1', tenantId: 'tenant-a', weekStart: '2026-10-19', weekEnd: '2026-10-25',
      totalPiles: 15, totalDrilling: 3, totalDowntime: 1.5, reportCount: 3,
    });
    expect(rows[0].dailyMetrics.map((item: {date: string}) => item.date)).toEqual(['2026-10-19', '2026-10-25']);
    expect(rows[1]).toMatchObject({weekStart: '2026-10-26', weekEnd: '2026-11-01', totalPiles: 7});
  });

  it('метрики дней внутри недели отсортированы по дате независимо от порядка чтения', async () => {
    h.dailyFindMany.mockResolvedValue([day('s1', '2026-10-22', 1), day('s1', '2026-10-20', 1), day('s1', '2026-10-21', 1)]);

    await rebuildSiteWeeklyTrend();

    const metrics = h.weeklyCreate.mock.calls[0][0].data[0].dailyMetrics;
    expect(metrics.map((item: {date: string}) => item.date)).toEqual(['2026-10-20', '2026-10-21', '2026-10-22']);
  });

  it('сутки объекта, которого нет среди объектов организации, получают текущую организацию', async () => {
    h.dailyFindMany.mockResolvedValue([day('s-unknown', '2026-10-20', 4)]);

    await rebuildSiteWeeklyTrend();

    expect(h.weeklyCreate.mock.calls[0][0].data[0].tenantId).toBe('tenant-a');
  });

  it('читает сутки только по объектам своей организации и чистит только её тренд', async () => {
    h.siteFindMany.mockResolvedValue([{id: 's1', tenantId: 'tenant-a'}, {id: 's2', tenantId: 'tenant-a'}]);

    await rebuildSiteWeeklyTrend();

    expect(h.siteFindMany.mock.calls[0][0].where).toEqual({tenantId: 'tenant-a'});
    expect(h.dailyFindMany.mock.calls[0][0].where).toEqual({siteId: {in: ['s1', 's2']}});
    expect(h.weeklyDelete).toHaveBeenCalledWith({where: {tenantId: 'tenant-a'}});
  });

  it('очистка предшествует записи в той же транзакции; пустые сутки дают пустой тренд', async () => {
    h.weeklyDelete.mockImplementation(async () => { h.order.push('delete'); });
    h.weeklyCreate.mockImplementation(async () => { h.order.push('create'); });

    const result = await rebuildSiteWeeklyTrend();

    expect(h.order).toEqual(['delete', 'create']);
    expect(result.rowsWritten).toBe(0);
    expect(h.weeklyCreate).toHaveBeenCalledWith({data: []});
  });
});

describe('rebuildReportAnalytics', () => {
  const report = (overrides: Record<string, unknown> = {}) => ({
    id: 'id-1', reportId: 'R-1', siteId: 's1', userId: 'u1', tenantId: 'tenant-a', status: 'submitted',
    updatedAt: new Date('2026-10-26T08:00:00Z'),
    piles: [{count: 3}, {count: null}], drillings: [{meters: 12.5}], downtimes: [{duration: 2}], ...overrides,
  });

  it('ключ — бизнес-id отчёта (reportId), а не первичный ключ; итоги пропускают пустые значения', async () => {
    h.reportFindMany.mockResolvedValue([report()]);

    const rows = await rebuildReportAnalytics();

    const call = h.analyticsUpsert.mock.calls[0][0];
    expect(call.where).toEqual({reportId: 'R-1'});
    expect(call.create).toMatchObject({reportId: 'R-1', totalPiles: 3, totalDrilling: 12.5, totalDowntime: 2, status: 'submitted'});
    expect(rows.rowsWritten).toBe(1);
  });

  it('отчёт без объекта или работника в аналитику не попадает', async () => {
    h.reportFindMany.mockResolvedValue([report({siteId: null}), report({reportId: 'R-2', userId: null}), report({reportId: 'R-3'})]);

    const rows = await rebuildReportAnalytics();

    expect(rows.rowsWritten).toBe(1);
    expect(h.analyticsUpsert).toHaveBeenCalledTimes(1);
  });

  it('читает отчёты только своей организации', async () => {
    await rebuildReportAnalytics();

    expect(h.reportFindMany.mock.calls[0][0].where).toEqual({tenantId: 'tenant-a'});
  });
});

describe('rebuildAll', () => {
  it('идёт в порядке «отчёты → сутки → недели»: недели читают сутки', async () => {
    h.analyticsUpsert.mockImplementation(async () => undefined);
    h.reportFindMany.mockImplementation(async () => { h.order.push('reports'); return []; });
    h.dailyCreate.mockImplementation(async () => { h.order.push('daily-write'); });
    h.dailyFindMany.mockImplementation(async () => { h.order.push('daily-read'); return []; });

    const results = await rebuildAll();

    expect(results.map((item) => item.name)).toEqual(['report-analytics', 'site-daily', 'site-weekly']);
    expect(h.order.indexOf('daily-write')).toBeLessThan(h.order.indexOf('daily-read'));
  });
});
