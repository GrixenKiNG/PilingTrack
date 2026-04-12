/**
 * Circuit Breaker Pattern
 *
 * Protects downstream services (e.g. database) from cascading failures.
 * States:
 *   CLOSED   — normal operation, requests pass through
 *   OPEN     — failures exceeded threshold, requests fail fast with 503
 *   HALF_OPEN — after resetTimeout, allow one probe request through
 *
 * Usage:
 *   const cb = new CircuitBreaker('db-health', { failureThreshold: 5, resetTimeoutMs: 30_000 });
 *   await cb.execute(() => db.$queryRaw`SELECT 1`);
 */

import { db } from '@/lib/db';

export interface CircuitBreakerConfig {
  failureThreshold: number;  // How many failures before opening
  resetTimeoutMs: number;    // Time before attempting recovery
}

export class CircuitBreaker {
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private failures = 0;
  private lastFailureTime = 0;
  private openSince = 0;

  constructor(
    private name: string,
    private config: CircuitBreakerConfig
  ) {}

  /**
   * Execute a function through the circuit breaker.
   * If the circuit is OPEN, throws CircuitOpenError immediately.
   * If HALF_OPEN, allows one probe request.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const currentState = this.getState();

    if (currentState === 'OPEN') {
      throw new CircuitOpenError(
        `Circuit breaker "${this.name}" is OPEN`,
        this.config.resetTimeoutMs
      );
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Get current state, transitioning from OPEN to HALF_OPEN if timeout elapsed.
   */
  getState(): 'CLOSED' | 'OPEN' | 'HALF_OPEN' {
    if (this.state === 'OPEN') {
      const elapsed = Date.now() - this.openSince;
      if (elapsed >= this.config.resetTimeoutMs) {
        this.state = 'HALF_OPEN';
        return 'HALF_OPEN';
      }
    }
    return this.state;
  }

  /**
   * Manually reset the circuit breaker to CLOSED state.
   */
  reset(): void {
    this.state = 'CLOSED';
    this.failures = 0;
    this.lastFailureTime = 0;
    this.openSince = 0;
  }

  /**
   * Get detailed stats for monitoring.
   */
  getStats(): {
    state: string;
    failures: number;
    failureThreshold: number;
    resetTimeoutMs: number;
    timeUntilRetry: number | null;
  } {
    const state = this.getState();
    let timeUntilRetry: number | null = null;

    if (state === 'OPEN') {
      const elapsed = Date.now() - this.openSince;
      timeUntilRetry = Math.max(0, this.config.resetTimeoutMs - elapsed);
    }

    return {
      state,
      failures: this.failures,
      failureThreshold: this.config.failureThreshold,
      resetTimeoutMs: this.config.resetTimeoutMs,
      timeUntilRetry,
    };
  }

  private onSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      // Probe succeeded, close the circuit
      this.state = 'CLOSED';
      this.failures = 0;
    } else {
      // Reset failure counter on any success in CLOSED state
      this.failures = 0;
    }
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.state === 'HALF_OPEN') {
      // Probe failed, go back to OPEN
      this.state = 'OPEN';
      this.openSince = Date.now();
    } else if (this.failures >= this.config.failureThreshold) {
      this.state = 'OPEN';
      this.openSince = Date.now();
    }
  }
}

/**
 * Error thrown when circuit breaker is OPEN.
 * Includes retry-after hint in milliseconds.
 */
export class CircuitOpenError extends Error {
  public readonly retryAfterMs: number;

  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = 'CircuitOpenError';
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Shared circuit breaker for database health checks.
 * Uses Prisma db.$queryRaw`SELECT 1` to verify DB connectivity.
 */
export const dbHealthCircuitBreaker = new CircuitBreaker('db-health', {
  failureThreshold: 5,
  resetTimeoutMs: 30_000, // 30 seconds
});

/**
 * Check database health through the circuit breaker.
 */
export async function checkDbHealth(): Promise<boolean> {
  try {
    await dbHealthCircuitBreaker.execute(async () => {
      await db.$queryRaw`SELECT 1`;
    });
    return true;
  } catch {
    return false;
  }
}
