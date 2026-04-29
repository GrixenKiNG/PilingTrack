/**
 * computePeriodSummary — pile meters regression test.
 *
 * Bug we're guarding (2026-04): PileWork.metersPerUnit doesn't exist —
 * the field lives on SitePilePlan. Earlier code read pile.metersPerUnit
 * directly, so totalPileMeters was always 0 in the period summary.
 *
 * Fix: compute totalPileMeters by joining (siteId, pileGradeId) → plan.
 * Fallback: parse a 3-digit number from the grade name (legacy heuristic).
 */
import { describe, it, expect } from 'vitest';
import { computePeriodSummary } from '../route';

describe('computePeriodSummary', () => {
  it('looks up metersPerUnit from SitePilePlan map by (siteId, pileGradeId)', () => {
    const reports = [
      {
        siteId: 'site_A',
        userId: 'op_1',
        piles: [
          { count: 10, pileGradeId: 'pg_1', pileGrade: { name: 'Ж/Б' } },
          { count: 5, pileGradeId: 'pg_2', pileGrade: { name: 'Ж/Б' } },
        ],
      },
    ];
    const plans = [
      { siteId: 'site_A', pileGradeId: 'pg_1', metersPerUnit: 6 },
      { siteId: 'site_A', pileGradeId: 'pg_2', metersPerUnit: 4 },
    ];
    const summary = computePeriodSummary(reports, plans);
    expect(summary.totalPiles).toBe(15);
    expect(summary.totalPileMeters).toBe(10 * 6 + 5 * 4); // 80
  });

  it('falls back to pileLengthFromName when plan is missing', () => {
    const reports = [
      {
        siteId: 'site_A',
        userId: 'op_1',
        piles: [{ count: 3, pileGradeId: 'pg_x', pileGrade: { name: 'C-300x300x6000' } }],
      },
    ];
    // 3-digit → 300/10 = 30. (Heuristic matches first 3-digit run.)
    const summary = computePeriodSummary(reports, []);
    expect(summary.totalPileMeters).toBe(3 * 30);
  });

  it('keeps siteId in the key — different sites must not bleed metersPerUnit', () => {
    const reports = [
      {
        siteId: 'site_A',
        userId: 'op_1',
        piles: [{ count: 2, pileGradeId: 'pg_shared', pileGrade: { name: 'X' } }],
      },
      {
        siteId: 'site_B',
        userId: 'op_1',
        piles: [{ count: 2, pileGradeId: 'pg_shared', pileGrade: { name: 'X' } }],
      },
    ];
    const plans = [
      { siteId: 'site_A', pileGradeId: 'pg_shared', metersPerUnit: 10 },
      // site_B has NO plan → falls back to pileLengthFromName('X') === 0
    ];
    const summary = computePeriodSummary(reports, plans);
    expect(summary.totalPileMeters).toBe(2 * 10 + 2 * 0);
  });

  it('aggregates drillings, downtimes and unique sets', () => {
    const reports = [
      {
        siteId: 's1', userId: 'u1',
        drillings: [{ count: 2, meters: 50 }, { count: 3, meters: 100 }],
        downtimes: [{ duration: 4 }],
      },
      {
        siteId: 's2', userId: 'u1',
        drillings: [{ meters: 25 }], // count missing → defaults to 1
        downtimes: [{ duration: 2 }, { duration: 3 }],
      },
    ];
    const summary = computePeriodSummary(reports, []);
    expect(summary.totalDrillingCount).toBe(2 + 3 + 1);
    expect(summary.totalDrilling).toBe(175);
    expect(summary.totalDowntime).toBe(9);
    expect(summary.uniqueSites).toBe(2);
    expect(summary.uniqueOperators).toBe(1);
    expect(summary.reportCount).toBe(2);
  });

  it('handles empty reports', () => {
    const summary = computePeriodSummary([], []);
    expect(summary).toEqual({
      totalPiles: 0, totalPileMeters: 0, totalDrillingCount: 0,
      totalDrilling: 0, totalDowntime: 0, reportCount: 0,
      uniqueSites: 0, uniqueOperators: 0,
    });
  });
});
