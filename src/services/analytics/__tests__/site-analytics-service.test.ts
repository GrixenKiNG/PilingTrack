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
