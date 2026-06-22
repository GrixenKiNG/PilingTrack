/**
 * computePeriodSummary — pile metres aggregation.
 *
 * Pile length comes from the grade (PileGrade.lengthMm), carried on each pile
 * row; SitePilePlan is no longer a length source (see lib/pile-length and the
 * tenant-dictionaries plan, Task 7'). Earlier code read a non-existent
 * pile.metersPerUnit, then briefly the site plan — both gone.
 */
import { describe, it, expect } from 'vitest';
import { computePeriodSummary } from '../route';

describe('computePeriodSummary', () => {
  it('sums pile metres from the grade length', () => {
    const reports = [
      {
        siteId: 'site_A',
        userId: 'op_1',
        piles: [
          { count: 10, pileGradeId: 'pg_1', pileGrade: { name: 'Ж/Б', lengthMm: 6000 } },
          { count: 5, pileGradeId: 'pg_2', pileGrade: { name: 'Ж/Б', lengthMm: 4000 } },
        ],
      },
    ];
    const summary = computePeriodSummary(reports);
    expect(summary.totalPiles).toBe(15);
    expect(summary.totalPileMeters).toBe(10 * 6 + 5 * 4); // 80
  });

  it('treats a grade with no stored length as 0 m (no name parsing)', () => {
    const reports = [
      {
        siteId: 'site_A',
        userId: 'op_1',
        piles: [{ count: 3, pileGradeId: 'pg_x', pileGrade: { name: 'С300' } }],
      },
    ];
    const summary = computePeriodSummary(reports);
    expect(summary.totalPileMeters).toBe(0);
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
    const summary = computePeriodSummary(reports);
    expect(summary.totalDrillingCount).toBe(2 + 3 + 1);
    expect(summary.totalDrilling).toBe(175);
    expect(summary.totalDowntime).toBe(9);
    expect(summary.uniqueSites).toBe(2);
    expect(summary.uniqueOperators).toBe(1);
    expect(summary.reportCount).toBe(2);
  });

  it('handles empty reports', () => {
    const summary = computePeriodSummary([]);
    expect(summary).toEqual({
      totalPiles: 0, totalPileMeters: 0, totalDrillingCount: 0,
      totalDrilling: 0, totalDowntime: 0, reportCount: 0,
      uniqueSites: 0, uniqueOperators: 0,
    });
  });
});
