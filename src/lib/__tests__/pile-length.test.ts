import { describe, it, expect } from 'vitest';
import { pileLengthMeters, lengthMmFromGradeName } from '../pile-length';

describe('pileLengthMeters', () => {
  it('computes grade length (mm -> m)', () => {
    expect(pileLengthMeters({ gradeLengthMm: 30000 })).toBe(30);
    expect(pileLengthMeters({ gradeLengthMm: 9000 })).toBe(9);
  });

  it('returns 0 when length is unknown (never re-parses a name)', () => {
    expect(pileLengthMeters({})).toBe(0);
    expect(pileLengthMeters({ gradeLengthMm: null })).toBe(0);
    expect(pileLengthMeters({ gradeLengthMm: 0 })).toBe(0);
  });
});

describe('lengthMmFromGradeName (one-time seed only)', () => {
  it('reproduces the legacy parse: first 3-digit run = decimetres', () => {
    // "С300" -> 30.0 m == old name.match(/\d{3}/)/10
    expect(lengthMmFromGradeName('С300')).toBe(30000);
    expect(lengthMmFromGradeName('С300.30-8')).toBe(30000);
  });

  it('returns null (= unknown) when there is no 3-digit run', () => {
    // exactly the cases the audit flagged as silently zeroed
    expect(lengthMmFromGradeName('С90.30')).toBeNull();
    expect(lengthMmFromGradeName('12 м')).toBeNull();
    expect(lengthMmFromGradeName('')).toBeNull();
  });

  it('seed then resolve equals the legacy metres value', () => {
    const seeded = lengthMmFromGradeName('С120');
    expect(pileLengthMeters({ gradeLengthMm: seeded })).toBe(12); // 120 dm /10
  });
});
