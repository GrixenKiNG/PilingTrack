/**
 * Circuit Breakers — Unit Tests
 *
 * Tests state machine: CLOSED → OPEN → HALF_OPEN → CLOSED
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CircuitBreaker, CircuitOpenError } from '../circuit-breakers';

describe('Circuit Breaker', () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    vi.useFakeTimers();
    cb = new CircuitBreaker('test', {
      failureThreshold: 3,
      resetTimeoutMs: 1000,
      maxResetTimeoutMs: 5000,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts in CLOSED state', () => {
    const state = cb.getState();
    expect(state.state).toBe('CLOSED');
    expect(state.failures).toBe(0);
  });

  it('transitions to OPEN after threshold failures', async () => {
    const failingFn = vi.fn().mockRejectedValue(new Error('fail'));

    for (let i = 0; i < 3; i++) {
      try {
        await cb.execute(failingFn);
      } catch {
        // expected
      }
    }

    const state = cb.getState();
    expect(state.state).toBe('OPEN');
    expect(state.failures).toBe(3);
  });

  it('throws CircuitOpenError when OPEN', async () => {
    const failingFn = vi.fn().mockRejectedValue(new Error('fail'));

    // Trigger OPEN
    for (let i = 0; i < 3; i++) {
      try { await cb.execute(failingFn); } catch {}
    }

    // Should throw CircuitOpenError
    await expect(cb.execute(vi.fn())).rejects.toThrow(CircuitOpenError);
  });

  it('transitions to HALF_OPEN after timeout', async () => {
    const failingFn = vi.fn().mockRejectedValue(new Error('fail'));

    // Trigger OPEN
    for (let i = 0; i < 3; i++) {
      try { await cb.execute(failingFn); } catch {}
    }

    expect(cb.getState().state).toBe('OPEN');

    // Advance past timeout
    vi.advanceTimersByTime(1000);

    const state = cb.getState();
    expect(state.state).toBe('HALF_OPEN');
  });

  it('closes circuit after 2 successes in HALF_OPEN', async () => {
    const failingFn = vi.fn().mockRejectedValue(new Error('fail'));
    const successFn = vi.fn().mockResolvedValue('ok');

    // Trigger OPEN
    for (let i = 0; i < 3; i++) {
      try { await cb.execute(failingFn); } catch {}
    }

    // Advance to HALF_OPEN
    vi.advanceTimersByTime(1000);
    expect(cb.getState().state).toBe('HALF_OPEN');

    // Two successes
    await cb.execute(successFn);
    await cb.execute(successFn);

    expect(cb.getState().state).toBe('CLOSED');
  });

  it('reopens circuit on failure in HALF_OPEN', async () => {
    const failingFn = vi.fn().mockRejectedValue(new Error('fail'));

    // Trigger OPEN
    for (let i = 0; i < 3; i++) {
      try { await cb.execute(failingFn); } catch {}
    }

    // Advance to HALF_OPEN
    vi.advanceTimersByTime(1000);
    expect(cb.getState().state).toBe('HALF_OPEN');

    // One failure in HALF_OPEN → reopen
    try { await cb.execute(failingFn); } catch {}

    expect(cb.getState().state).toBe('OPEN');
  });

  it('exponential backoff increases reset timeout', async () => {
    const failingFn = vi.fn().mockRejectedValue(new Error('fail'));

    // Trigger OPEN (3 failures)
    for (let i = 0; i < 3; i++) {
      try { await cb.execute(failingFn); } catch {}
    }

    // First timeout: 1000ms
    vi.advanceTimersByTime(500);
    expect(cb.getState().state).toBe('OPEN');

    vi.advanceTimersByTime(500);
    expect(cb.getState().state).toBe('HALF_OPEN');

    // Failure in HALF_OPEN → reopen with 2x timeout
    try { await cb.execute(failingFn); } catch {}
    expect(cb.getState().state).toBe('OPEN');

    // Now timeout should be 2000ms
    vi.advanceTimersByTime(1500);
    expect(cb.getState().state).toBe('OPEN');

    vi.advanceTimersByTime(500);
    expect(cb.getState().state).toBe('HALF_OPEN');
  });

  it('manual reset clears all state', async () => {
    const failingFn = vi.fn().mockRejectedValue(new Error('fail'));

    for (let i = 0; i < 3; i++) {
      try { await cb.execute(failingFn); } catch {}
    }

    cb.reset();

    const state = cb.getState();
    expect(state.state).toBe('CLOSED');
    expect(state.failures).toBe(0);
  });
});
