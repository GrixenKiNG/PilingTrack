/**
 * Error Tracker — For SLO / Circuit Breaker Integration
 *
 * Tracks error rates per domain for:
 * - Circuit breaker decisions (auto-open on high error rate)
 * - SLO error budget computation
 * - Burn rate alerting
 *
 * Uses in-memory sliding window (per-process).
 * For multi-instance, switch to Redis-based counter.
 */


interface ErrorRecord {
  domain: string;
  error: Error;
  context: Record<string, unknown>;
  timestamp: number;
}

interface RequestRecord {
  domain: string;
  timestamp: number;
}

interface DomainStats {
  totalRequests: number;
  totalErrors: number;
  errorRate: number;
  windowStart: number;
  windowSizeMs: number;
}

class ErrorTracker {
  private records: ErrorRecord[] = [];
  private requests: RequestRecord[] = [];
  private readonly windowSizeMs: number;
  private readonly maxRecords: number;

  constructor(options?: { windowSizeMs?: number; maxRecords?: number }) {
    this.windowSizeMs = options?.windowSizeMs ?? 60_000; // 1 minute window
    this.maxRecords = options?.maxRecords ?? 10_000;
  }

  record(record: { domain: string; error: Error; context?: Record<string, unknown> }): void {
    this.records.push({
      domain: record.domain,
      error: record.error,
      context: record.context || {},
      timestamp: Date.now(),
    });

    // Prevent memory leak
    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(-this.maxRecords);
    }
  }

  /**
   * Record a request for a domain. Called on every inbound request by the
   * api-wrapper so that getStats can report a real totalRequests and a real
   * errorRate (previously we fabricated totalRequests as errors*20, which
   * locked errorRate at ~5% and made circuit-breaker/SLO logic useless).
   */
  recordRequest(domain: string): void {
    this.requests.push({ domain, timestamp: Date.now() });
    if (this.requests.length > this.maxRecords) {
      this.requests = this.requests.slice(-this.maxRecords);
    }
  }

  getStats(domain: string): DomainStats {
    const now = Date.now();
    const windowStart = now - this.windowSizeMs;

    const windowErrors = this.records.filter(
      (r) => r.domain === domain && r.timestamp >= windowStart
    );
    const windowRequests = this.requests.filter(
      (r) => r.domain === domain && r.timestamp >= windowStart
    );

    const totalErrors = windowErrors.length;
    const totalRequests = windowRequests.length;
    const errorRate = totalRequests > 0 ? totalErrors / totalRequests : 0;

    return {
      totalRequests,
      totalErrors,
      errorRate,
      windowStart,
      windowSizeMs: this.windowSizeMs,
    };
  }

  /**
   * Check if error rate exceeds threshold.
   * Used by circuit breakers to auto-open.
   */
  isErrorRateExceeded(domain: string, threshold: number): boolean {
    const stats = this.getStats(domain);
    return stats.errorRate > threshold;
  }

  /**
   * Get error budget remaining for SLO tracking.
   * Returns 0.0 to 1.0 (1.0 = full budget, 0.0 = exhausted)
   */
  getErrorBudgetRemaining(domain: string, sloTarget: number): number {
    const stats = this.getStats(domain);
    if (stats.totalRequests === 0) return 1.0;

    const allowedErrors = stats.totalRequests * (1 - sloTarget);
    const actualErrors = stats.totalErrors;
    const remaining = Math.max(0, allowedErrors - actualErrors);

    return remaining / Math.max(1, allowedErrors);
  }

  /**
   * Clear old records outside the window.
   */
  prune(): void {
    const cutoff = Date.now() - this.windowSizeMs;
    this.records = this.records.filter((r) => r.timestamp >= cutoff);
    this.requests = this.requests.filter((r) => r.timestamp >= cutoff);
  }
}

// Singleton
export const errorTracker = new ErrorTracker();

// Auto-prune every minute
setInterval(() => errorTracker.prune(), 60_000);

export function recordError(record: { domain: string; error: Error; context?: Record<string, unknown> }): void {
  errorTracker.record(record);
}

export function recordRequest(domain: string): void {
  errorTracker.recordRequest(domain);
}
