import { describe, it, expect } from 'vitest';
import type { ReportDTO } from '@/lib/types';
import { getPileLengthMeters, getReportTotals, addTotals, shiftDurationHours } from '../report-totals';

// The four functions only read piles/drillings/downtimes/shiftStart/shiftEnd, so
// a minimal partial cast is enough to exercise them.
function report(over: Partial<ReportDTO>): ReportDTO {
  return { piles: [], drillings: [], downtimes: [], shiftStart: null, shiftEnd: null, ...over } as unknown as ReportDTO;
}

describe('getPileLengthMeters', () => {
  it('reads the first 3-digit run as decimetres', () => {
    expect(getPileLengthMeters('С-300')).toBe(30);
    expect(getPileLengthMeters('Свая 450 мм')).toBe(45);
  });
  it('returns 0 when there is no 3-digit run', () => {
    expect(getPileLengthMeters('С-12')).toBe(0);
    expect(getPileLengthMeters('')).toBe(0);
  });
});

describe('getReportTotals', () => {
  it('sums piles/metres/drilling/downtime for one report', () => {
    const t = getReportTotals(report({
      piles: [{ count: 2, pileGrade: { name: 'С-300' } }, { count: 3, pileGrade: { name: 'С-100' } }] as ReportDTO['piles'],
      drillings: [{ count: 4, meters: 12 }, { count: 0, meters: 5 }] as ReportDTO['drillings'],
      downtimes: [{ duration: 1.5 }, { duration: 0.5 }] as ReportDTO['downtimes'],
    }));
    expect(t.piles).toBe(5);                 // 2 + 3
    expect(t.pileMeters).toBe(2 * 30 + 3 * 10); // 90
    expect(t.drillingCount).toBe(5);         // 4 + (0||1)=1
    expect(t.drillingMeters).toBe(17);       // 12 + 5
    expect(t.downtimeHours).toBe(2);         // 1.5 + 0.5
    expect(t.photoCount).toBe(0);
  });

  it('handles a report with no work', () => {
    expect(getReportTotals(report({}))).toEqual({
      piles: 0, pileMeters: 0, drillingCount: 0, drillingMeters: 0, downtimeHours: 0, photoCount: 0,
    });
  });
});

describe('addTotals', () => {
  it('sums totals across reports', () => {
    const r = report({
      piles: [{ count: 1, pileGrade: { name: 'С-300' } }] as ReportDTO['piles'],
      downtimes: [{ duration: 2 }] as ReportDTO['downtimes'],
    });
    const sum = addTotals([r, r, r]);
    expect(sum.piles).toBe(3);
    expect(sum.pileMeters).toBe(90); // 30 * 3
    expect(sum.downtimeHours).toBe(6);
  });
});

describe('shiftDurationHours', () => {
  it('computes a normal shift', () => {
    expect(shiftDurationHours(report({ shiftStart: '08:00', shiftEnd: '17:00' }))).toBe(9);
  });
  it('wraps an overnight shift', () => {
    expect(shiftDurationHours(report({ shiftStart: '22:00', shiftEnd: '06:00' }))).toBe(8);
  });
  it('returns null when start/end is missing or invalid', () => {
    expect(shiftDurationHours(report({ shiftStart: null, shiftEnd: '17:00' }))).toBeNull();
    expect(shiftDurationHours(report({ shiftStart: 'xx:yy', shiftEnd: '17:00' }))).toBeNull();
  });
});
