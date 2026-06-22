import { describe, it, expect } from 'vitest';
import {
  isInspectionRecord,
  isOpenRecord,
  computeToStats,
  daysUntil,
  dueText,
  type JournalRecord,
} from '../to-stats';

function rec(over: Partial<JournalRecord>): JournalRecord {
  return {
    id: 'r', type: 'REPAIR', status: 'DONE', title: 'x',
    scheduledAt: null, completedAt: null, createdAt: '2026-06-01T00:00:00.000Z',
    engineHoursAtService: null, inspection: null,
    ...over,
  };
}

describe('record predicates', () => {
  it('classifies inspection vs repair by type', () => {
    expect(isInspectionRecord(rec({ type: 'TO2' }))).toBe(true);
    expect(isInspectionRecord(rec({ type: 'REPAIR' }))).toBe(false);
  });
  it('classifies open by status', () => {
    expect(isOpenRecord(rec({ status: 'IN_PROGRESS' }))).toBe(true);
    expect(isOpenRecord(rec({ status: 'DONE' }))).toBe(false);
  });
});

describe('computeToStats', () => {
  it('counts inspections, repairs and open records', () => {
    const stats = computeToStats([
      rec({ type: 'EO', status: 'DONE' }),
      rec({ type: 'TO1', status: 'PLANNED' }),
      rec({ type: 'REPAIR', status: 'IN_PROGRESS' }),
      rec({ type: 'REPAIR', status: 'DONE' }),
    ]);
    expect(stats).toEqual({ inspections: 2, repairs: 2, open: 2, averageScore: null });
  });

  it('averages inspection healthScores (rounded), ignoring non-scored', () => {
    const stats = computeToStats([
      rec({ type: 'EO', inspection: { id: '1', healthScore: 80, status: 'DONE', level: 'EO' } }),
      rec({ type: 'TO1', inspection: { id: '2', healthScore: 91, status: 'DONE', level: 'TO1' } }),
      rec({ type: 'TO2', inspection: { id: '3', healthScore: null, status: 'DONE', level: 'TO2' } }),
      rec({ type: 'REPAIR' }),
    ]);
    expect(stats.averageScore).toBe(86); // round((80+91)/2)
  });

  it('handles an empty journal', () => {
    expect(computeToStats([])).toEqual({ inspections: 0, repairs: 0, open: 0, averageScore: null });
  });
});

// Local-time (no "Z") midday strings: daysUntil compares LOCAL midnights, so
// midday keeps the day-count exact in any runner timezone.
const LOCAL_NOON = new Date('2026-06-20T12:00:00');

describe('daysUntil / dueText', () => {
  it('daysUntil counts whole days from now (midnight)', () => {
    expect(daysUntil('2026-06-20T18:00:00', LOCAL_NOON)).toBe(0);
    expect(daysUntil('2026-06-23T06:00:00', LOCAL_NOON)).toBe(3);
    expect(daysUntil('2026-06-18T06:00:00', LOCAL_NOON)).toBe(-2);
    expect(daysUntil(null, LOCAL_NOON)).toBeNull();
    expect(daysUntil('not-a-date', LOCAL_NOON)).toBeNull();
  });

  it('dueText renders the right Russian phrase per branch', () => {
    expect(dueText(null, LOCAL_NOON)).toBe('срок не задан');
    expect(dueText('2026-06-18T06:00:00', LOCAL_NOON)).toBe('просрочено');
    expect(dueText('2026-06-20T18:00:00', LOCAL_NOON)).toBe('сегодня');
    expect(dueText('2026-06-21T06:00:00', LOCAL_NOON)).toBe('завтра');
    expect(dueText('2026-06-25T06:00:00', LOCAL_NOON)).toBe('через 5 дн.');
  });

  it('does not mutate the passed-in now', () => {
    const now = new Date('2026-06-20T12:00:00');
    daysUntil('2026-07-01T06:00:00', now);
    expect(now.getTime()).toBe(new Date('2026-06-20T12:00:00').getTime());
  });
});
