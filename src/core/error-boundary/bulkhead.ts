/**
 * Bulkhead Pattern — Failure Isolation for Domains
 *
 * Inspired by ship bulkheads: if one compartment floods,
 * the ship stays afloat.
 *
 * In our context: if reports-service is overloaded,
 * it should NOT affect auth, sites, crews, etc.
 *
 * Implementation:
 * - Per-domain semaphore (concurrency limit)
 * - Per-domain timeout
 * - Per-domain error tracking
 * - Rejection with 503 when bulkhead is full
 *
 * Usage:
 *   const bulkhead = createBulkhead('reports', { maxConcurrency: 50, timeoutMs: 10000 });
 *   const result = await bulkhead.execute(async () => {
 *     return db.report.findMany(...);
 *   });
 */

import { logger } from '@/lib/logger';

export interface BulkheadConfig {
  maxConcurrency: number;
  timeoutMs: number;
  domain: string;
  maxQueueSize?: number;
}

interface BulkheadStats {
  domain: string;
  activeRequests: number;
  queuedRequests: number;
  rejectedRequests: number;
  timedOutRequests: number;
  avgExecutionTimeMs: number;
}

class BulkheadRejectError extends Error {
  constructor(public readonly domain: string, maxConcurrency: number) {
    super(`Bulkhead "${domain}" at capacity (${maxConcurrency}). Request rejected.`);
    this.name = 'BulkheadRejectError';
  }
}

export class Bulkhead {
  private activeCount = 0;
  private queue: Array<{
    fn: () => Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeoutId: ReturnType<typeof setTimeout>;
    enqueuedAt: number;
    settled: boolean;  // Prevents double-settlement
  }> = [];
  private totalRejected = 0;
  private totalTimedOut = 0;
  private totalCompleted = 0;
  private totalExecutionTimeMs = 0;

  constructor(private readonly config: BulkheadConfig) {}

  /**
   * Execute a function through the bulkhead.
   * If at capacity, queues the request (up to queueLimit).
   * If queue is full, rejects immediately with 503.
   */
  async execute<T>(
    fn: () => Promise<T>,
    options?: { timeoutMs?: number }
  ): Promise<T> {
    const timeout = options?.timeoutMs ?? this.config.timeoutMs;

    // Fast path: if under capacity, execute immediately
    if (this.activeCount < this.config.maxConcurrency) {
      return this.runWithTracking(fn, timeout);
    }

    // Queue size limit
    const maxQueueSize = this.config.maxQueueSize ?? this.config.maxConcurrency * 2;
    if (this.queue.length >= maxQueueSize) {
      this.totalRejected++;
      throw new BulkheadRejectError(this.config.domain, this.config.maxConcurrency);
    }

    // Queue the request
    return new Promise<T>((resolve, reject) => {
      const entry = {
        fn,
        resolve: resolve as (value: unknown) => void,
        reject,
        timeoutId: null as unknown as ReturnType<typeof setTimeout>,
        enqueuedAt: Date.now(),
        settled: false,
      };

      entry.timeoutId = setTimeout(() => {
        if (entry.settled) return; // Already settled by processQueue
        entry.settled = true;
        this.totalTimedOut++;
        this.totalRejected++;
        reject(
          new BulkheadRejectError(this.config.domain, this.config.maxConcurrency)
        );
      }, timeout);

      this.queue.push(entry);
    });
  }

  /**
   * Run a single request with execution time tracking.
   */
  private async runWithTracking<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
    this.activeCount++;
    const startTime = Date.now();

    try {
      const result = await this.withTimeout(fn(), timeoutMs);
      const executionTime = Date.now() - startTime;
      this.totalCompleted++;
      this.totalExecutionTimeMs += executionTime;
      return result;
    } catch (error) {
      const executionTime = Date.now() - startTime;
      this.totalExecutionTimeMs += executionTime;
      throw error;
    } finally {
      this.activeCount--;
      this.processQueue();
    }
  }

  /**
   * Process next queued request if any.
   */
  private processQueue(): void {
    if (this.queue.length === 0) return;
    if (this.activeCount >= this.config.maxConcurrency) return;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null invariant established earlier in this function
    const next = this.queue.shift()!;
    clearTimeout(next.timeoutId);

    // Check if the request already exceeded its timeout while in queue
    const elapsedInQueue = Date.now() - next.enqueuedAt;
    if (elapsedInQueue >= this.config.timeoutMs) {
      if (!next.settled) {
        next.settled = true;
        this.totalTimedOut++;
        this.totalRejected++;
        next.reject(
          new BulkheadRejectError(this.config.domain, this.config.maxConcurrency)
        );
      }
      // Process next in queue
      this.processQueue();
      return;
    }

    // Execute the queued function with remaining timeout — guard against double-settlement
    const remainingTimeout = this.config.timeoutMs - elapsedInQueue;
    let settled = false;
    const safeResolve = (value: unknown) => {
      if (!settled) { settled = true; next.resolve(value); }
    };
    const safeReject = (error: Error) => {
      if (!settled) { settled = true; next.reject(error); }
    };

    this.runWithTracking(next.fn as () => Promise<unknown>, remainingTimeout)
      .then(safeResolve)
      .catch(safeReject);
  }

  /**
   * Timeout wrapper.
   */
  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`Bulkhead timeout after ${timeoutMs}ms (domain: ${this.config.domain})`));
      }, timeoutMs);
    });

    const result = await Promise.race([promise, timeoutPromise]);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null invariant established earlier in this function
    clearTimeout(timeoutId!);
    return result;
  }

  /**
   * Get current stats for monitoring.
   */
  getStats(): BulkheadStats {
    return {
      domain: this.config.domain,
      activeRequests: this.activeCount,
      queuedRequests: this.queue.length,
      rejectedRequests: this.totalRejected,
      timedOutRequests: this.totalTimedOut,
      avgExecutionTimeMs:
        this.totalCompleted > 0
          ? this.totalExecutionTimeMs / this.totalCompleted
          : 0,
    };
  }
}

// ============================================================
// Registry — Per-domain bulkheads
// ============================================================

const bulkheads = new Map<string, Bulkhead>();

export function getBulkhead(domain: string): Bulkhead {
  if (!bulkheads.has(domain)) {
    // Default config per domain
    const configs: Record<string, BulkheadConfig> = {
      reports: { maxConcurrency: 50, timeoutMs: 15_000, domain: 'reports' },
      sites: { maxConcurrency: 30, timeoutMs: 10_000, domain: 'sites' },
      crews: { maxConcurrency: 20, timeoutMs: 10_000, domain: 'crews' },
      equipment: { maxConcurrency: 20, timeoutMs: 10_000, domain: 'equipment' },
      auth: { maxConcurrency: 100, timeoutMs: 5_000, domain: 'auth' },
      telemetry: { maxConcurrency: 200, timeoutMs: 3_000, domain: 'telemetry' },
      analytics: { maxConcurrency: 10, timeoutMs: 30_000, domain: 'analytics' },
      sync: { maxConcurrency: 20, timeoutMs: 20_000, domain: 'sync' },
    };

    const config = configs[domain] || {
      maxConcurrency: 30,
      timeoutMs: 10_000,
      domain,
    };

    bulkheads.set(domain, new Bulkhead(config));
    logger.info('Bulkhead created', { domainName: domain, maxConcurrency: config.maxConcurrency, timeoutMs: config.timeoutMs });
  }

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null invariant established earlier in this function
  return bulkheads.get(domain)!;
}

/**
 * Get health status of all bulkheads.
 */
export function getBulkheadHealth(): Record<string, BulkheadStats> {
  const result: Record<string, BulkheadStats> = {};
  for (const [domain, bulkhead] of bulkheads) {
    result[domain] = bulkhead.getStats();
  }
  return result;
}

/**
 * Log bulkhead stats periodically.
 */
setInterval(() => {
  const stats = getBulkheadHealth();
  const activeDomains = Object.entries(stats).filter(
    ([, s]) => s.activeRequests > 0 || s.queuedRequests > 0
  );

  if (activeDomains.length > 0) {
    logger.info('Bulkhead stats', {
      domains: Object.fromEntries(
        activeDomains.map(([domain, s]) => [
          domain,
          {
            active: s.activeRequests,
            queued: s.queuedRequests,
            rejected: s.rejectedRequests,
            avgMs: Math.round(s.avgExecutionTimeMs),
          },
        ])
      ),
    });
  }
}, 30_000);

export { BulkheadRejectError };
