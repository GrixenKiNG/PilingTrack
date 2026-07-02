import { describe, it, expect } from 'vitest';
import {
  isInspectionRecord,
  isOpenRecord,
  computeToStats,
  findOverdueMaintenance,
  findUncrewedEquipment,
  staleOpenOrderDays,
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

describe('findOverdueMaintenance', () => {
  const NOW = new Date('2026-06-20T12:00:00.000Z');

  it('flags equipment overdue by planned date', () => {
    const out = findOverdueMaintenance(
      [{ id: 'a', name: 'Копёр-1', nextMaintenanceDate: '2026-06-10T00:00:00.000Z' }],
      NOW,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'a', reason: 'date', overdueDays: 10, overdueHours: null });
  });

  it('flags equipment overdue by engine-hour threshold', () => {
    const out = findOverdueMaintenance(
      [{ id: 'b', name: 'Копёр-2', engineHoursTotal: 520, nextMaintenanceAtHours: 500 }],
      NOW,
    );
    expect(out[0]).toMatchObject({ id: 'b', reason: 'hours', overdueDays: null, overdueHours: 20 });
  });

  it('marks reason "both" and excludes not-yet-due equipment', () => {
    const out = findOverdueMaintenance(
      [
        { id: 'c', name: 'оба', engineHoursTotal: 600, nextMaintenanceAtHours: 500, nextMaintenanceDate: '2026-06-01T00:00:00.000Z' },
        { id: 'd', name: 'в норме', engineHoursTotal: 100, nextMaintenanceAtHours: 500, nextMaintenanceDate: '2026-12-01T00:00:00.000Z' },
        { id: 'e', name: 'без порогов' },
      ],
      NOW,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'c', reason: 'both' });
  });

  it('sorts most-overdue (by days) first', () => {
    const out = findOverdueMaintenance(
      [
        { id: 'small', name: 's', nextMaintenanceDate: '2026-06-19T00:00:00.000Z' },
        { id: 'big', name: 'b', nextMaintenanceDate: '2026-05-20T00:00:00.000Z' },
      ],
      NOW,
    );
    expect(out.map((o) => o.id)).toEqual(['big', 'small']);
  });
});

describe('staleOpenOrderDays', () => {
  const NOW = new Date('2026-07-02T00:00:00Z');

  it('flags an open order older than the threshold with its age in days', () => {
    expect(staleOpenOrderDays({ status: 'IN_PROGRESS', createdAt: '2026-06-10T00:00:00Z' }, NOW)).toBe(22);
  });

  it('returns null for fresh, closed, or dateless orders', () => {
    expect(staleOpenOrderDays({ status: 'IN_PROGRESS', createdAt: '2026-06-25T00:00:00Z' }, NOW)).toBeNull();
    expect(staleOpenOrderDays({ status: 'DONE', createdAt: '2026-01-01T00:00:00Z' }, NOW)).toBeNull();
    expect(staleOpenOrderDays({ status: 'CANCELLED', createdAt: '2026-01-01T00:00:00Z' }, NOW)).toBeNull();
    expect(staleOpenOrderDays({ status: 'PLANNED', createdAt: null }, NOW)).toBeNull();
  });
});

describe('findUncrewedEquipment', () => {
  it('flags active equipment with no crew', () => {
    const out = findUncrewedEquipment([
      { id: 'a', name: 'Копёр-1', isActive: true, crewCount: 0 },
      { id: 'b', name: 'Копёр-2', isActive: true, crewCount: 1 },
      { id: 'c', name: 'Копёр-3 (списан)', isActive: false, crewCount: 0 },
    ]);
    expect(out.map((o) => o.id)).toEqual(['a']);
  });
});
