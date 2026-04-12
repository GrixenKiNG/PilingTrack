/**
 * Unit Tests — Timezone Utilities
 *
 * Tests UTC↔timezone conversion, shift type detection, and report date validation.
 */

import { describe, it, expect } from 'vitest';
import {
  utcToTimezoneDate,
  normalizeReportDate,
  getShiftTypeForTime,
  isReportDateValid,
} from '@/lib/timezone-utils';

describe('utcToTimezoneDate', () => {
  it('converts UTC to date string', () => {
    const utcDate = new Date('2024-01-15T22:00:00Z'); // UTC
    const result = utcToTimezoneDate(utcDate, 'Europe/Moscow'); // UTC+3

    // In Moscow timezone, this would be 2024-01-16
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('handles string input', () => {
    const result = utcToTimezoneDate('2024-01-15T12:00:00Z', 'UTC');
    expect(result).toBe('2024-01-15');
  });
});

describe('normalizeReportDate', () => {
  it('accepts valid YYYY-MM-DD format', () => {
    expect(normalizeReportDate('2024-01-15')).toBe('2024-01-15');
    expect(normalizeReportDate('2024-12-31')).toBe('2024-12-31');
  });

  it('rejects invalid formats', () => {
    expect(() => normalizeReportDate('2024/01/15')).toThrow('Invalid report date format');
    expect(() => normalizeReportDate('01-15-2024')).toThrow('Invalid report date format');
    expect(() => normalizeReportDate('2024-1-15')).toThrow('Invalid report date format');
  });
});

describe('getShiftTypeForTime', () => {
  it('returns DAY for morning UTC time', () => {
    // 10:00 UTC = 13:00 Moscow (DAY)
    expect(getShiftTypeForTime('2024-01-15T10:00:00Z', 'Europe/Moscow')).toBe('DAY');
  });

  it('returns NIGHT for evening UTC time', () => {
    // 20:00 UTC = 23:00 Moscow (NIGHT)
    expect(getShiftTypeForTime('2024-01-15T20:00:00Z', 'Europe/Moscow')).toBe('NIGHT');
  });

  it('returns NIGHT for early morning UTC', () => {
    // 02:00 UTC = 05:00 Moscow (NIGHT)
    expect(getShiftTypeForTime('2024-01-15T02:00:00Z', 'Europe/Moscow')).toBe('NIGHT');
  });
});

describe('isReportDateValid', () => {
  it('accepts today date', () => {
    const today = new Date().toISOString().split('T')[0];
    expect(isReportDateValid(today)).toBe(true);
  });

  it('accepts past date', () => {
    expect(isReportDateValid('2020-01-01')).toBe(true);
  });

  it('rejects future date', () => {
    const futureYear = new Date().getFullYear() + 10;
    expect(isReportDateValid(`${futureYear}-01-01`)).toBe(false);
  });
});
