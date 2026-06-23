import { describe, it, expect } from 'vitest';
import { computeOperatorRotation } from '../operator-rotation';
import type { TimelineRow } from '../equipment-detail-parts';

function row(p: Partial<TimelineRow> & { date: string; operatorId: string | null }): TimelineRow {
  return {
    reportId: `r-${p.date}-${p.operatorId}-${p.shiftType ?? 'DAY'}`,
    date: p.date,
    shiftType: p.shiftType ?? 'DAY',
    status: 'submitted',
    siteName: p.siteName ?? 'Куст 12',
    operatorId: p.operatorId,
    operatorName: p.operatorName ?? (p.operatorId ? `Op ${p.operatorId}` : null),
    updatedAt: '2026-06-01T00:00:00.000Z',
    piles: null, drillingMeters: null, downtimeHours: null,
  };
}

describe('computeOperatorRotation', () => {
  it('returns [] for no rows', () => {
    expect(computeOperatorRotation([])).toEqual([]);
  });

  it('groups a single operator across days into one segment', () => {
    const segs = computeOperatorRotation([
      row({ date: '2026-06-01', operatorId: 'a' }),
      row({ date: '2026-06-02', operatorId: 'a' }),
      row({ date: '2026-06-03', operatorId: 'a' }),
    ]);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({
      operatorId: 'a', startDate: '2026-06-01', endDate: '2026-06-03',
      shiftCount: 3, isSubstitution: false,
    });
  });

  it('marks substitutions on A -> B -> A and returns newest first', () => {
    const segs = computeOperatorRotation([
      row({ date: '2026-06-01', operatorId: 'a' }),
      row({ date: '2026-06-02', operatorId: 'b' }),
      row({ date: '2026-06-03', operatorId: 'a' }),
    ]);
    expect(segs.map((s) => s.operatorId)).toEqual(['a', 'b', 'a']);
    expect(segs.map((s) => s.isSubstitution)).toEqual([true, true, false]);
    expect(segs[2]).toMatchObject({ startDate: '2026-06-01', endDate: '2026-06-01' });
  });

  it('counts day+night by the same operator on one date as one segment, two shifts', () => {
    const segs = computeOperatorRotation([
      row({ date: '2026-06-01', operatorId: 'a', shiftType: 'NIGHT' }),
      row({ date: '2026-06-01', operatorId: 'a', shiftType: 'DAY' }),
    ]);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ shiftCount: 2, startDate: '2026-06-01', endDate: '2026-06-01' });
  });

  it('detects an intra-day substitution: day A, night B on the same date', () => {
    const segs = computeOperatorRotation([
      row({ date: '2026-06-01', operatorId: 'b', shiftType: 'NIGHT' }),
      row({ date: '2026-06-01', operatorId: 'a', shiftType: 'DAY' }),
    ]);
    expect(segs.map((s) => s.operatorId)).toEqual(['b', 'a']);
    expect(segs.map((s) => s.isSubstitution)).toEqual([true, false]);
  });

  it('collects distinct site names per segment', () => {
    const segs = computeOperatorRotation([
      row({ date: '2026-06-01', operatorId: 'a', siteName: 'Куст 12' }),
      row({ date: '2026-06-02', operatorId: 'a', siteName: 'Куст 4' }),
    ]);
    expect(segs[0].siteNames).toEqual(['Куст 12', 'Куст 4']);
  });
});
