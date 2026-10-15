/**
 * Regression: actual pile metres (м.п. факт) must come from PileGrade.lengthMm,
 * the single source of truth (see src/lib/pile-length.ts), not from
 * SitePilePlan.metersPerUnit (a planning figure with known-unreliable values,
 * e.g. 123 m/pile) or a 3-digit regex on the grade name. Those were the old
 * per-screen length sources that drifted from the report/PDF/dashboard figures
 * computed via pileLengthMeters().
 *
 * plannedPileMeters legitimately keeps using SitePilePlan.metersPerUnit — it's
 * a target figure, not derived from actual reports — so this only pins the
 * "actual" (PileWork-joined) subquery.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { queryRaw } = vi.hoisted(() => ({ queryRaw: vi.fn() }));

vi.mock('@/lib/db', () => ({ db: { $queryRaw: queryRaw } }));

import { getSiteAnalytics } from '../site-analytics-service';
import { computeDashboardKpis } from '@/components/piling/dashboard-kpis';
import { formatDowntimeHours } from '@/lib/downtime-hours';

describe('getSiteAnalytics — точность простоя на дашборде (I8)', () => {
  const siteRow = (siteId: string, totalDowntime: number) => ({
    siteId, siteName: siteId, isActive: true,
    plannedPiles: 0, plannedPileMeters: 0, plannedDrillingCount: 0,
    actualPiles: 0, actualPileMeters: 0, actualDrillingCount: 0,
    plannedDrilling: 0, actualDrilling: 0,
    actualPilesAllTime: 0, actualPileMetersAllTime: 0, actualDrillingAllTime: 0,
    totalDowntime, totalReports: 1,
  });

  beforeEach(() => queryRaw.mockReset());

  it('показывает 0,05 часа как 3 минуты, без удвоения до 6 минут', async () => {
    queryRaw.mockResolvedValue([siteRow('site-1', 0.05)]);

    const rows = await getSiteAnalytics({
      tenantId: 'orion', dateFrom: '2026-10-07', dateTo: '2026-10-07',
    });
    const kpis = computeDashboardKpis(rows, null, new Map(), []);

    expect(rows[0].totalDowntime).toBe(0.05);
    expect(kpis.downtime).toBe(0.05);
    expect(formatDowntimeHours(kpis.downtime)).toBe('3 мин');
  });

  it('суммирует дробные часы разных объектов до округления минут для показа', async () => {
    queryRaw.mockResolvedValue([
      siteRow('site-1', 0.05), siteRow('site-2', 0.02), siteRow('site-3', 0.01),
    ]);

    const rows = await getSiteAnalytics({tenantId: 'orion'});
    const kpis = computeDashboardKpis(rows, null, new Map(), []);

    expect(rows.map((row) => row.totalDowntime)).toEqual([0.05, 0.02, 0.01]);
    expect(kpis.downtime).toBeCloseTo(0.08);
    expect(formatDowntimeHours(kpis.downtime)).toBe('5 мин');
  });
});

describe('getSiteAnalytics — actual pile meters source', () => {
  beforeEach(() => {
    queryRaw.mockReset();
    queryRaw.mockResolvedValue([]);
  });

  it('computes actual pile meters from PileGrade.lengthMm, not the site plan or the grade name', async () => {
    await getSiteAnalytics({ tenantId: 'orion' });

    const [strings] = queryRaw.mock.calls[0];
    const sql = (strings as string[]).join('?');

    const actualBlockStart = sql.indexOf('SUM(pw.count)');
    const actualBlockEnd = sql.indexOf(') p ON');
    expect(actualBlockStart).toBeGreaterThan(-1);
    expect(actualBlockEnd).toBeGreaterThan(actualBlockStart);
    const actualBlock = sql.slice(actualBlockStart, actualBlockEnd);

    expect(actualBlock).toContain('"lengthMm"');
    expect(actualBlock).not.toContain('metersPerUnit');
    expect(actualBlock).not.toContain('SitePilePlan');
  });

  it('computes planned pile meters from PileGrade.lengthMm, never parsing the grade name (F-16)', async () => {
    await getSiteAnalytics({ tenantId: 'orion' });

    const [strings] = queryRaw.mock.calls[0];
    const sql = (strings as string[]).join('?');

    // Нигде в запросе имя марки больше не парсится эвристикой.
    expect(sql).not.toContain('substring');
    expect(sql).not.toContain('pg.name');

    const planBlockStart = sql.indexOf('spp."siteId"');
    const planBlockEnd = sql.indexOf(') pp ON');
    expect(planBlockStart).toBeGreaterThan(-1);
    expect(planBlockEnd).toBeGreaterThan(planBlockStart);
    const planBlock = sql.slice(planBlockStart, planBlockEnd);

    // Явный план на объекте (metersPerUnit) остаётся первым, запасной источник —
    // lengthMm марки, тот же, что и у факта.
    expect(planBlock).toContain('"lengthMm"');
    expect(planBlock).toContain('"metersPerUnit"');
    expect(planBlock).not.toContain('substring');
  });
});

/**
 * Regression for F-R35-1: deactivating a finished site must not erase its
 * production from a past period. A site is now listed when it is active *or*
 * when it submitted a report inside the requested period — an inactive site
 * with no reports in the period stays out of the list.
 */
describe('getSiteAnalytics — deactivated sites of a past period', () => {
  beforeEach(() => {
    queryRaw.mockReset();
    queryRaw.mockResolvedValue([]);
  });

  it('lists an inactive site only through a submitted report of the period', async () => {
    await getSiteAnalytics({ tenantId: 'orion', dateFrom: '2026-09-01', dateTo: '2026-09-30' });

    const [strings, ...params] = queryRaw.mock.calls[0];
    const sql = (strings as string[]).join('?');

    // Site selection is a disjunction now, not the bare `isActive = true`.
    expect(sql).not.toMatch(/WHERE\s+s\."isActive" = true\s*\n\s*AND\s+s\."tenantId"/);
    const existsStart = sql.indexOf('OR EXISTS (');
    const tenantPredicate = sql.indexOf('AND s."tenantId" =');
    expect(existsStart).toBeGreaterThan(-1);
    expect(tenantPredicate).toBeGreaterThan(existsStart);
    const siteFilter = sql.slice(existsStart, tenantPredicate);

    expect(siteFilter).toContain('FROM "Report" r');
    expect(siteFilter).toContain('r."siteId" = s.id');
    expect(siteFilter).toContain('r.status = ?');
    expect(params).toContain('submitted');
    expect(siteFilter).toContain('r.date >= ?');
    expect(siteFilter).toContain('r.date <= ?');

    // The period bounds stay bound parameters — never interpolated as text.
    expect(params).toContain('2026-09-01');
    expect(params).toContain('2026-09-30');
    expect(sql).not.toContain('2026-09-01');
    expect(sql).toContain('s."tenantId" = ?');

    // isActive travels with the row so the UI can mark «объект закрыт».
    expect(sql).toMatch(/s\."isActive"\s+AS "isActive"/);
  });
});

/**
 * Regression for F-R52: pile/drilling progress must be cumulative (all-time
 * actual vs whole-site plan), never the period actual. In the «7 дней» mode a
 * finished site (950 of 1000 piles) with 20 piles that week used to show 2%
 * and raised a false «отставание плана».
 */
describe('getSiteAnalytics — cumulative progress (F-R52)', () => {
  beforeEach(() => {
    queryRaw.mockReset();
    queryRaw.mockResolvedValue([]);
  });

  it('derives progress from the all-time actual, not the period actual', async () => {
    queryRaw.mockResolvedValue([
      {
        siteId: 's1', siteName: 'Объект А', isActive: true,
        plannedPiles: 1000, plannedPileMeters: 5000, plannedDrillingCount: 10,
        actualPiles: 20, actualPileMeters: 100, actualDrillingCount: 0,
        plannedDrilling: 100, actualDrilling: 5,
        actualPilesAllTime: 950, actualPileMetersAllTime: 4750, actualDrillingAllTime: 60,
        totalDowntime: 0, totalReports: 3,
      },
    ]);

    const [row] = await getSiteAnalytics({
      tenantId: 'orion', dateFrom: '2026-09-23', dateTo: '2026-09-29',
    });

    // 20 шт за неделю из 950 всего при плане 1000 → 95%, не 2%.
    expect(row.pileProgress).toBe(95);
    expect(row.drillingProgress).toBe(60);
    expect(row.actualPiles).toBe(20); // «за период» остаётся периодным
    expect(row.actualPilesAllTime).toBe(950);
  });

  it('queries the all-time actuals without a date filter', async () => {
    await getSiteAnalytics({ tenantId: 'orion', dateFrom: '2026-09-23', dateTo: '2026-09-29' });

    const [strings] = queryRaw.mock.calls[0];
    const sql = (strings as string[]).join('?');

    // Unfiltered totals and FILTER period totals share the same aggregate.
    const allTimeBlock = sql.slice(sql.indexOf('SUM(pw.count)'), sql.indexOf(') p ON'));
    expect(allTimeBlock).toContain('SUM(pw.count)::int AS total_piles_all');
    expect(allTimeBlock).toContain('r.status = ?');
    expect(queryRaw.mock.calls[0].slice(1)).toContain('submitted');
    expect(allTimeBlock).toContain('FILTER (WHERE r.date >=');
  });
});

/**
 * F-ANALYTICS-TENANT-SQL (F-20): тенант — только строгое равенство по
 * `s."tenantId"`, а отсутствующий tenantId падает ДО запроса. Единственный
 * `IS NULL OR` в этом запросе — необязательный фильтр объекта интерфейса
 * (siteId); если он когда-нибудь переедет на tenantId, запрос начнёт отдавать
 * строки всех организаций.
 */
describe('getSiteAnalytics — tenant isolation (F-ANALYTICS-TENANT-SQL)', () => {
  beforeEach(() => {
    queryRaw.mockReset();
    queryRaw.mockResolvedValue([]);
  });

  it('scopes the raw query by strict tenant equality, never `tenantId … IS NULL`', async () => {
    await getSiteAnalytics({ tenantId: 'orion', siteId: 'site_A' });

    const [strings, ...params] = queryRaw.mock.calls[0];
    const sql = (strings as string[]).join('?');

    expect(sql).toContain('s."tenantId" = ?');
    expect(sql).not.toMatch(/tenantId"?\s*(::text\s*)?IS NULL/i);
    expect(params).toContain('orion');

    // Единственное IS NULL OR — фильтр объекта, и он привязан к s.id, не к тенанту.
    expect(sql.match(/IS NULL OR/g) ?? []).toHaveLength(1);
    expect(sql).toMatch(/\?::text IS NULL OR s\.id = \?/);
  });

  it('throws on a missing tenantId and never reaches $queryRaw', async () => {
    const withoutTenant = {} as Parameters<typeof getSiteAnalytics>[0];

    await expect(getSiteAnalytics(withoutTenant)).rejects.toThrow(/tenantId/i);
    await expect(getSiteAnalytics({ tenantId: '' })).rejects.toThrow(/tenantId/i);

    expect(queryRaw).not.toHaveBeenCalled();
  });
});


it('период и весь срок читают PileWork одним агрегатом', async () => {
  queryRaw.mockReset().mockResolvedValue([]);
  await getSiteAnalytics({tenantId:'orion',dateFrom:'2026-09-01',dateTo:'2026-09-30'});
  const sql = queryRaw.mock.calls[0][0].join('?');
  expect(sql.match(/JOIN "PileWork"/g)).toHaveLength(1);
  expect(sql).toContain('FILTER (WHERE r.date >=');
  expect(sql).toContain('total_piles_all');
});
