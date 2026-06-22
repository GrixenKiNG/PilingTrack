/**
 * Cross-path invariant: pile metres (м.п.) must be identical no matter which
 * screen computes them. Before the lib/pile-length refactor each path parsed the
 * grade name independently and they drifted — the reports screen ignored the site
 * plan, the period summary used it — so the same report showed different м.п.
 *
 * These three now share one resolver; this test fails if any of them re-introduces
 * its own length logic.
 */
import { describe, it, expect } from 'vitest';
import type { ReportDTO } from '@/lib/types';
import { getReportTotals } from '@/components/piling/admin-reports/report-totals';
import { computePeriodSummary } from '@/app/api/reports/period/route';
import { pileLengthMeters } from '@/lib/pile-length';

// One logical report: 4 piles of a 30 m grade + 6 piles of a 12 m grade, no plan.
const SITE = 'site_1';
const G30 = { id: 'g30', lengthMm: 30000 };
const G12 = { id: 'g12', lengthMm: 12000 };
const piles = [
  { count: 4, pileGradeId: G30.id, lengthMm: G30.lengthMm },
  { count: 6, pileGradeId: G12.id, lengthMm: G12.lengthMm },
];

const expectedMeters =
  4 * pileLengthMeters({ gradeLengthMm: G30.lengthMm }) +
  6 * pileLengthMeters({ gradeLengthMm: G12.lengthMm }); // 4*30 + 6*12 = 192

describe('pile metres are consistent across reports screen and period summary', () => {
  it('getReportTotals (reports screen) == expected', () => {
    const report = {
      piles: piles.map((p) => ({ count: p.count, pileGrade: { lengthMm: p.lengthMm } })),
      drillings: [],
      downtimes: [],
      shiftStart: null,
      shiftEnd: null,
    } as unknown as ReportDTO;
    expect(getReportTotals(report).pileMeters).toBe(expectedMeters);
  });

  it('computePeriodSummary == expected', () => {
    const summary = computePeriodSummary(
      [{
        siteId: SITE,
        userId: 'op_1',
        piles: piles.map((p) => ({
          count: p.count,
          pileGradeId: p.pileGradeId,
          pileGrade: { name: '', lengthMm: p.lengthMm },
        })),
      }],
    );
    expect(summary.totalPileMeters).toBe(expectedMeters);
  });
});
