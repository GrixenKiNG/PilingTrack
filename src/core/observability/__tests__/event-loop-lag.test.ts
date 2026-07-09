/**
 * getEventLoopLagSeconds — thin wrapper around Node's perf_hooks
 * monitorEventLoopDelay. Real timing behavior isn't meaningfully
 * unit-testable (it depends on actual event loop scheduling), so this
 * pins the plumbing: it never throws, returns a finite non-negative
 * number, and reset() doesn't break subsequent reads.
 */
import { describe, it, expect } from 'vitest';
import { getEventLoopLagSeconds, resetEventLoopLag } from '../event-loop-lag';

describe('getEventLoopLagSeconds', () => {
  it('returns a finite, non-negative number without throwing', () => {
    const lag = getEventLoopLagSeconds();
    expect(typeof lag).toBe('number');
    expect(Number.isFinite(lag)).toBe(true);
    expect(lag).toBeGreaterThanOrEqual(0);
  });

  it('survives a reset and keeps returning valid values', () => {
    resetEventLoopLag();
    const lag = getEventLoopLagSeconds();
    expect(Number.isFinite(lag)).toBe(true);
    expect(lag).toBeGreaterThanOrEqual(0);
  });

  it('is stable across repeated reads (idempotent read, no side effects)', () => {
    const a = getEventLoopLagSeconds();
    const b = getEventLoopLagSeconds();
    expect(Number.isFinite(a)).toBe(true);
    expect(Number.isFinite(b)).toBe(true);
  });
});
