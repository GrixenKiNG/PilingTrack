import { describe, it, expect } from 'vitest';
import { getMaintenanceFlag } from '../equipment-maintenance-flag';

const NOW = new Date('2026-06-20T12:00:00.000Z');

describe('getMaintenanceFlag', () => {
  it('returns null when no maintenance data', () => {
    expect(
      getMaintenanceFlag({ nextMaintenanceDate: null, nextMaintenanceAtHours: null, engineHoursTotal: 1000 }, NOW),
    ).toBeNull();
  });

  it('flags overdue when the date is in the past', () => {
    expect(
      getMaintenanceFlag({ nextMaintenanceDate: '2026-06-19T00:00:00.000Z', nextMaintenanceAtHours: null, engineHoursTotal: null }, NOW),
    ).toBe('overdue');
  });

  it.each([
    '2026-06-19T21:00:00.000Z',
    '2026-06-20T12:00:00.000Z',
    '2026-06-20T20:59:59.999Z',
  ])('keeps the planned date due today until Moscow midnight: %s', (instant) => {
    expect(getMaintenanceFlag({ nextMaintenanceDate: '2026-06-20T00:00:00.000Z', nextMaintenanceAtHours: null, engineHoursTotal: null }, new Date(instant))).toBe('soon');
  });

  it('marks the planned date overdue at the next Moscow midnight', () => {
    expect(getMaintenanceFlag({ nextMaintenanceDate: '2026-06-20', nextMaintenanceAtHours: null, engineHoursTotal: null }, new Date('2026-06-20T21:00:00.000Z'))).toBe('overdue');
  });

  it('uses whole calendar days for the seven-day soon window', () => {
    const lateToday = new Date('2026-06-20T20:59:59.999Z');
    expect(getMaintenanceFlag({ nextMaintenanceDate: '2026-06-27', nextMaintenanceAtHours: null, engineHoursTotal: null }, lateToday)).toBe('soon');
    expect(getMaintenanceFlag({ nextMaintenanceDate: '2026-06-28', nextMaintenanceAtHours: null, engineHoursTotal: null }, lateToday)).toBeNull();
  });

  it('uses the Moscow day of a saved full timestamp, rather than its UTC date part', () => {
    expect(getMaintenanceFlag({ nextMaintenanceDate: '2026-06-19T22:00:00.000Z', nextMaintenanceAtHours: null, engineHoursTotal: null }, NOW)).toBe('soon');
  });

  it('flags overdue when engine hours reached the threshold', () => {
    expect(
      getMaintenanceFlag({ nextMaintenanceDate: null, nextMaintenanceAtHours: 9000, engineHoursTotal: 9000 }, NOW),
    ).toBe('overdue');
  });

  it('flags soon within the day window', () => {
    expect(
      getMaintenanceFlag({ nextMaintenanceDate: '2026-06-25T12:00:00.000Z', nextMaintenanceAtHours: null, engineHoursTotal: null }, NOW),
    ).toBe('soon');
  });

  it('flags soon within the hours window (boundary = 50h left)', () => {
    expect(
      getMaintenanceFlag({ nextMaintenanceDate: null, nextMaintenanceAtHours: 9000, engineHoursTotal: 8950 }, NOW),
    ).toBe('soon');
  });

  it('returns null when maintenance is comfortably ahead', () => {
    expect(
      getMaintenanceFlag({ nextMaintenanceDate: '2026-08-01T00:00:00.000Z', nextMaintenanceAtHours: 9000, engineHoursTotal: 7000 }, NOW),
    ).toBeNull();
  });
});
