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
    expect(siteFilter).toContain("r.status = 'submitted'");
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
