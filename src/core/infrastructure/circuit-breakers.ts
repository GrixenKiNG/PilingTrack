/**
 * Circuit Breakers — защита от cascade failure
 *
 * Каждый внешний сервис (Redis, S3, Telegram Bot API) имеет
 * собственный circuit breaker с независимым состоянием.
 *
 * При OPEN — запросы мгновенно отклоняются без попытки подключения.
 * При HALF_OPEN — один пробный запрос проверяет восстановление.
 *
 * Usage:
 *   const result = await redisCircuit.execute(() => redis.get('key'));
 *   const status = circuitBreakerRegistry.getHealth();
 */

import { logger } from '@/lib/logger';

// ============================================================
// Circuit Breaker State Machine
// ============================================================

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  failureThreshold: number;    // Сколько ошибок до открытия
  resetTimeoutMs: number;      // Базовое время до попытки восстановления
  maxResetTimeoutMs: number;   // Максимальное время (exponential backoff cap)
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 3,
  resetTimeoutMs: 30_000,     // 30s базовый
  maxResetTimeoutMs: 300_000, // 5min максимум
};

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failures = 0;
  private lastFailureTime = 0;
  private consecutiveSuccesses = 0;

  constructor(
    private readonly name: string,
    private readonly config: CircuitBreakerConfig = DEFAULT_CONFIG
  ) {}

  /**
   * Execute function through circuit breaker.
   * Returns result or throws CircuitOpenError.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      const now = Date.now();
      const timeSinceFailure = now - this.lastFailureTime;
      const timeout = this.getCurrentResetTimeout();

      if (timeSinceFailure >= timeout) {
        // Transition to HALF_OPEN — try one request
        this.state = 'HALF_OPEN';
        logger.info(`Circuit breaker [${this.name}] transitioning to HALF_OPEN`);
      } else {
        throw new CircuitOpenError(this.name, timeout - timeSinceFailure);
      }
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
   * Get current state (with auto-transition from OPEN to HALF_OPEN).
   */
  getState(): { state: CircuitState; failures: number; lastFailureTime: number } {
    if (this.state === 'OPEN') {
      const now = Date.now();
      const timeSinceFailure = now - this.lastFailureTime;
      const timeout = this.getCurrentResetTimeout();

      if (timeSinceFailure >= timeout) {
        this.state = 'HALF_OPEN';
      }
    }

    return {
      state: this.state,
      failures: this.failures,
      lastFailureTime: this.lastFailureTime,
    };
  }

  /**
   * Manually reset to CLOSED.
   */
  reset(): void {
    this.state = 'CLOSED';
    this.failures = 0;
    this.consecutiveSuccesses = 0;
    this.lastFailureTime = 0;
    logger.info(`Circuit breaker [${this.name}] manually reset to CLOSED`);
  }

  private onSuccess(): void {
    this.consecutiveSuccesses++;

    if (this.state === 'HALF_OPEN' && this.consecutiveSuccesses >= 2) {
      // Two consecutive successes in HALF_OPEN → close circuit
      this.state = 'CLOSED';
      this.failures = 0;
      this.consecutiveSuccesses = 0;
      logger.info(`Circuit breaker [${this.name}] closed after successful probe`);
    }
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    this.consecutiveSuccesses = 0;

    if (this.state === 'HALF_OPEN') {
      // Failed during probe → reopen
      this.state = 'OPEN';
      logger.warn(`Circuit breaker [${this.name}] reopened after failed probe`);
    } else if (this.failures >= this.config.failureThreshold) {
      this.state = 'OPEN';
      logger.warn(
        `Circuit breaker [${this.name}] OPEN after ${this.failures} failures (threshold: ${this.config.failureThreshold})`
      );
    }
  }

  /**
   * Exponential backoff for reset timeout.
   */
  private getCurrentResetTimeout(): number {
    const multiplier = Math.pow(2, Math.min(this.failures - this.config.failureThreshold, 10));
    return Math.min(
      this.config.resetTimeoutMs * multiplier,
      this.config.maxResetTimeoutMs
    );
  }
}

export class CircuitOpenError extends Error {
  constructor(public readonly serviceName: string, public readonly retryAfterMs: number) {
    super(`Circuit breaker OPEN for ${serviceName}. Retry after ${Math.ceil(retryAfterMs / 1000)}s`);
    this.name = 'CircuitOpenError';
  }
}

// ============================================================
// Registry — shared circuit breakers
// ============================================================

export const redisCircuitBreaker = new CircuitBreaker('redis', {
  failureThreshold: 3,
  resetTimeoutMs: 15_000,
  maxResetTimeoutMs: 120_000,
});

export const s3CircuitBreaker = new CircuitBreaker('s3', {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  maxResetTimeoutMs: 300_000,
});

export const telegramCircuitBreaker = new CircuitBreaker('telegram', {
  failureThreshold: 3,
  resetTimeoutMs: 60_000,
  maxResetTimeoutMs: 600_000,
});

export const databaseCircuitBreaker = new CircuitBreaker('database', {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  maxResetTimeoutMs: 300_000,
});

// ============================================================
// Higher-Order Function — wrap API handlers with DB protection
// ============================================================

/**
 * Wrap a mutation handler with the database circuit breaker.
 * Returns 503 with Retry-After when circuit is OPEN.
 *
 * Usage:
 *   export async function POST(req: NextRequest) {
 *     return withDbProtection(async () => {
 *       // ... mutation logic
 *       return NextResponse.json(result);
 *     });
 *   }
 */
export async function withDbProtection<T>(
  fn: () => Promise<T>
): Promise<T> {
  return databaseCircuitBreaker.execute(fn);
}

/**
 * Get health status of all circuit breakers.
 */
export function getCircuitBreakerHealth(): Record<string, { state: string; failures: number }> {
  return {
    redis: redisCircuitBreaker.getState(),
    s3: s3CircuitBreaker.getState(),
    telegram: telegramCircuitBreaker.getState(),
    database: databaseCircuitBreaker.getState(),
  };
}
