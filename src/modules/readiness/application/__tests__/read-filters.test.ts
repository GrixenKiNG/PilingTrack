import {describe, expect, it} from 'vitest';
import {parseReadinessReadFilters, serializeReadinessFilters} from '../read-filters';

describe('readiness read filters', () => {
  it('interprets date-only boundaries in the organization timezone', () => {
    const filters = parseReadinessReadFilters(new URLSearchParams('from=2026-08-02&to=2026-08-02'), 'Europe/Moscow');
    expect(filters.from?.toISOString()).toBe('2026-08-01T21:00:00.000Z');
    expect(filters.to?.toISOString()).toBe('2026-08-02T20:59:59.999Z');
  });

  it('keeps the supported URL filter contract serializable', () => {
    const filters = parseReadinessReadFilters(new URLSearchParams('status=READY&shiftType=DAY&risk=ELEVATED&eventType=Shift&actor=ivanov'));
    expect(serializeReadinessFilters(filters)).toMatchObject({
      status: 'READY', shiftType: 'DAY', risk: 'ELEVATED', eventType: 'Shift', actor: 'ivanov',
    });
  });

  it('rejects an inverted interval', () => {
    expect(() => parseReadinessReadFilters(new URLSearchParams('from=2026-08-03&to=2026-08-02'))).toThrow(/не может быть позже/i);
  });
});
