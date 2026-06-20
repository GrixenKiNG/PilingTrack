import { describe, it, expect } from 'vitest';
import { formatNumber, formatFixed } from '@/lib/format';

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
