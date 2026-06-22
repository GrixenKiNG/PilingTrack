import { describe, it, expect } from 'vitest';
import { formatNumber, formatFixed, formatRuDate, formatPersonName } from '@/lib/format';

describe('formatRuDate', () => {
  it('formats a date-only string as DD.MM.YYYY', () => {
    expect(formatRuDate('2026-06-20')).toBe('20.06.2026');
  });
  it('uses only the date part of an ISO timestamp (timezone-safe)', () => {
    expect(formatRuDate('2026-06-20T23:00:00.000Z')).toBe('20.06.2026');
  });
  it('returns "—" for null/undefined/empty/malformed', () => {
    expect(formatRuDate(null)).toBe('—');
    expect(formatRuDate(undefined)).toBe('—');
    expect(formatRuDate('')).toBe('—');
    expect(formatRuDate('abc')).toBe('—');
  });
});

describe('formatPersonName', () => {
  it('renders "Surname N.P." for Surname Name Patronymic', () => {
    expect(formatPersonName('Иванов Иван Иванович')).toBe('Иванов И.И.');
  });
  it('detects surname-first order via patronymic suffix', () => {
    expect(formatPersonName('Иван Иванович')).toBe('Иванович И.'); // 2 tokens: last is surname
    expect(formatPersonName('Петров Сергей Петрович')).toBe('Петров С.П.');
  });
  it('passes through a single token and blanks empties', () => {
    expect(formatPersonName('Иванов')).toBe('Иванов');
    expect(formatPersonName('')).toBe('—');
    expect(formatPersonName(null)).toBe('—');
  });
});

// Locks the distinction between the two number formatters so they don't get
// "unified" by mistake — they intentionally differ on trailing zeros.
describe('formatNumber vs formatFixed', () => {
  it('formatNumber shows up to N decimals and drops trailing zeros', () => {
    expect(formatNumber(12, 1)).toBe('12');
    expect(formatNumber(12.5, 1)).toBe('12,5');
    expect(formatNumber(12.34, 1)).toBe('12,3');
  });

  it('formatFixed always pads to exactly N decimals', () => {
    expect(formatFixed(12, 1)).toBe('12,0');
    expect(formatFixed(12, 2)).toBe('12,00');
    expect(formatFixed(12.5, 1)).toBe('12,5');
  });

  it('the two agree when decimals = 0 (no fractional part to pad)', () => {
    expect(formatFixed(6, 0)).toBe(formatNumber(6, 0));
    expect(formatFixed(5.7, 0)).toBe(formatNumber(5.7, 0)); // both round to "6"
  });
});
