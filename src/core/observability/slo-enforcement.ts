/**
 * SLO Enforcement — Error Budget + Burn Rate Alerts
 *
 * Principal Engineer design:
 * Implements Google SRE methodology for reliability tracking.
 *
 * Concepts:
 * - SLO (Service Level Objective): Target reliability (e.g. 99.9%)
 * - SLI (Service Level Indicator): Actual measured reliability
 * - Error Budget: Allowed downtime (1 - SLO) × time window
 * - Burn Rate: How fast we're consuming error budget
 *
 * Architecture:
 * ┌─────────────────────────────────────────────────────┐
 * │ SLO Tracker (per domain)                             │
 * │  ├── Tracks: totalRequests, failedRequests           │
 * │  ├── Computes: SLI, errorBudget, burnRate           │
 * │  └── Alerts: multi-window burn rate detection       │
 * │                                                     │
 * │ Burn Rate Alerting (Google SRE):                     │
 * │  ├── Short window (5m) + high burn (14.4x) → P1    │
 * │  ├── Medium window (1h) + medium burn (6x) → P2    │
 * │  ├── Long window (6h) + low burn (3x) → P3         │
 * │  └── Very long window (1d) + slow burn (1x) → P4   │
 * └─────────────────────────────────────────────────────┘
 *
 * Usage:
 *   const slo = createSLO('reports', { target: 0.999, windowMs: 3600_000 });
 *   slo.recordRequest({ success: true, latencyMs: 150 });
 *   slo.recordRequest({ success: false, latencyMs: 5000 });
 *
 *   const status = slo.getStatus();
 *   // { sli: 0.998, errorBudget: 0.001, burnRate: 2.0, alerts: [...] }
 *
 *   const alerts = slo.checkBurnRateAlerts();
 *   // [{ severity: 'P2', burnRate: 6.0, window: '1h', ... }]
 */

import { logger } from '@/lib/logger';

// ============================================================
// Types
// ============================================================

export interface SLOConfig {
  target: number;           // e.g. 0.999 = 99.9%
  windowMs: number;         // Measurement window (default: 1 hour)
  latencyThresholdMs: number; // Requests slower than this count as failures (default: 5000)
  domain: string;
}

export interface RequestRecord {
  success: boolean;
  latencyMs: number;
  timestamp?: number;
  userId?: string;
  tenantId?: string;
}

export interface SLOStatus {
  domain: string;
  sli: number;              // Measured reliability (0.0 to 1.0)
  sloTarget: number;        // Target (e.g. 0.999)
  errorBudgetRemaining: number; // 0.0 to 1.0 (1.0 = full budget)
  burnRate: number;         // > 1.0 means burning faster than allowed
  totalRequests: number;
  failedRequests: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  windowStart: number;
  windowEnd: number;
}

export interface BurnRateAlert {
  severity: 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
  burnRate: number;
  window: string;
  message: string;
  triggeredAt: number;
  errorBudgetRemaining: number;
}

// Google SRE multi-window burn rate thresholds
// See: https://sre.google/workbook/alerting-on-slos/
const BURN_RATE_WINDOWS = [
  { shortWindowMs: 5 * 60 * 1000, longWindowMs: 60 * 60 * 1000, burnRate: 14.4, severity: 'P1' as const, label: '5m/1h' },
  { shortWindowMs: 30 * 60 * 1000, longWindowMs: 6 * 60 * 60 * 1000, burnRate: 6, severity: 'P2' as const, label: '30m/6h' },
  { shortWindowMs: 2 * 60 * 60 * 1000, longWindowMs: 24 * 60 * 60 * 1000, burnRate: 3, severity: 'P3' as const, label: '2h/1d' },
  { shortWindowMs: 6 * 60 * 60 * 1000, longWindowMs: 3 * 24 * 60 * 60 * 1000, burnRate: 1, severity: 'P4' as const, label: '6h/3d' },
];

// ============================================================
// SLO Tracker
// ============================================================

export class SLOTracker {
  private records: RequestRecord[] = [];
  private config: SLOConfig;
  private activeAlerts: BurnRateAlert[] = [];
  private totalRequestsAllTime = 0;
  private failedRequestsAllTime = 0;

  constructor(config: SLOConfig) {
    this.config = config;

    // Auto-prune old records
    setInterval(() => this.prune(), 60_000);
  }

  /**
   * Record a request for SLO measurement.
   */
  recordRequest(record: RequestRecord): void {
    this.records.push({
      ...record,
      timestamp: record.timestamp ?? Date.now(),
    });

    this.totalRequestsAllTime++;
    if (!record.success) {
      this.failedRequestsAllTime++;
    }

    // Prevent memory leak
    if (this.records.length > 100_000) {
      this.records = this.records.slice(-50_000);
    }
  }

  /**
   * Get current SLO status.
   */
  getStatus(): SLOStatus {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    const windowRecords = this.records.filter(
      (r) => (r.timestamp ?? 0) >= windowStart
    );

    const totalRequests = windowRecords.length;
    const failedRequests = windowRecords.filter(
      (r) => !r.success || r.latencyMs > this.config.latencyThresholdMs
    ).length;

    const sli = totalRequests > 0
      ? 1 - (failedRequests / totalRequests)
      : 1.0;

    const errorBudget = 1 - this.config.target;
    const actualErrorRate = 1 - sli;
    const errorBudgetRemaining = Math.max(0, 1 - (actualErrorRate / errorBudget));
    const burnRate = errorBudget > 0 ? actualErrorRate / errorBudget : 0;

    const latencies = windowRecords.map((r) => r.latencyMs).sort((a, b) => a - b);

    return {
      domain: this.config.domain,
      sli,
      sloTarget: this.config.target,
      errorBudgetRemaining,
      burnRate,
      totalRequests,
      failedRequests,
      avgLatencyMs: latencies.length > 0
        ? latencies.reduce((a, b) => a + b, 0) / latencies.length
        : 0,
      p95LatencyMs: latencies.length > 0
        ? latencies[Math.floor(latencies.length * 0.95)]
        : 0,
      p99LatencyMs: latencies.length > 0
        ? latencies[Math.floor(latencies.length * 0.99)]
        : 0,
      windowStart,
      windowEnd: now,
    };
  }

  /**
   * Check multi-window burn rate alerts.
   * Returns list of triggered alerts (empty if none).
   */
  checkBurnRateAlerts(): BurnRateAlert[] {
    const status = this.getStatus();
    const now = Date.now();
    const newAlerts: BurnRateAlert[] = [];

    for (const window of BURN_RATE_WINDOWS) {
      // Check short window burn rate
      const shortWindowStart = now - window.shortWindowMs;
      const shortRecords = this.records.filter(
        (r) => (r.timestamp ?? 0) >= shortWindowStart
      );

      if (shortRecords.length < 10) continue; // Not enough data

      const shortFailures = shortRecords.filter(
        (r) => !r.success || r.latencyMs > this.config.latencyThresholdMs
      ).length;

      const shortErrorRate = shortFailures / shortRecords.length;
      const errorBudget = 1 - this.config.target;
      const shortBurnRate = errorBudget > 0 ? shortErrorRate / errorBudget : 0;

      // Check long window burn rate for confirmation
      const longWindowStart = now - window.longWindowMs;
      const longRecords = this.records.filter(
        (r) => (r.timestamp ?? 0) >= longWindowStart
      );

      if (longRecords.length < 10) continue; // Not enough data

      const longFailures = longRecords.filter(
        (r) => !r.success || r.latencyMs > this.config.latencyThresholdMs
      ).length;

      const longErrorRate = longFailures / longRecords.length;
      const longBurnRate = errorBudget > 0 ? longErrorRate / errorBudget : 0;

      // Alert if BOTH windows exceed the burn rate threshold
      if (shortBurnRate >= window.burnRate && longBurnRate >= window.burnRate) {
        const alert: BurnRateAlert = {
          severity: window.severity,
          burnRate: Math.max(shortBurnRate, longBurnRate),
          window: window.label,
          message: `SLO burn rate ${Math.round(Math.max(shortBurnRate, longBurnRate) * 10) / 10}x ` +
            `for ${window.label} window on "${this.config.domain}" ` +
            `(threshold: ${window.burnRate}x, budget remaining: ${Math.round(status.errorBudgetRemaining * 100)}%)`,
          triggeredAt: now,
          errorBudgetRemaining: status.errorBudgetRemaining,
        };

        // Only add if not already active (deduplication)
        const existingAlert = this.activeAlerts.find(
          (a) => a.severity === alert.severity && a.window === alert.window
        );
        if (!existingAlert) {
          newAlerts.push(alert);
          logger.warn(`SLO ALERT: ${alert.message}`);
        }
      }
    }

    // Clear resolved alerts
    this.activeAlerts = this.activeAlerts.filter((existingAlert) => {
      const stillTriggered = newAlerts.find(
        (a) => a.severity === existingAlert.severity && a.window === existingAlert.window
      );
      if (!stillTriggered) {
        logger.info(`SLO alert resolved: ${existingAlert.severity} for ${this.config.domain}`);
      }
      return !!stillTriggered;
    });

    this.activeAlerts.push(...newAlerts);
    return newAlerts;
  }

  /**
   * Get active (unresolved) alerts.
   */
  getActiveAlerts(): BurnRateAlert[] {
    return [...this.activeAlerts];
  }

  /**
   * Get all-time stats (since process start).
   */
  getAllTimeStats(): {
    totalRequests: number;
    failedRequests: number;
    errorRate: number;
  } {
    return {
      totalRequests: this.totalRequestsAllTime,
      failedRequests: this.failedRequestsAllTime,
      errorRate: this.totalRequestsAllTime > 0
        ? this.failedRequestsAllTime / this.totalRequestsAllTime
        : 0,
    };
  }

  /**
   * Prune records outside the largest window.
   */
  private prune(): void {
    const maxWindow = 3 * 24 * 60 * 60 * 1000; // 3 days (largest burn rate window)
    const cutoff = Date.now() - maxWindow;
    this.records = this.records.filter((r) => (r.timestamp ?? 0) >= cutoff);
  }

  /**
   * Get config.
   */
  getConfig(): SLOConfig {
    return { ...this.config };
  }
}

// ============================================================
// Registry — Per-domain SLO tracking
// ============================================================

const sloTrackers = new Map<string, SLOTracker>();

export function createSLO(domain: string, config: Omit<SLOConfig, 'domain'>): SLOTracker {
  if (!sloTrackers.has(domain)) {
    sloTrackers.set(domain, new SLOTracker({ ...config, domain }));
  }
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null invariant established earlier in this function
  return sloTrackers.get(domain)!;
}

export function getSLO(domain: string): SLOTracker | undefined {
  return sloTrackers.get(domain);
}

/**
 * Get health of all SLO trackers.
 */
export function getSLOHealth(): Record<string, SLOStatus> {
  const result: Record<string, SLOStatus> = {};
  for (const [domain, tracker] of sloTrackers) {
    result[domain] = tracker.getStatus();
  }
  return result;
}

/**
 * Check burn rate alerts across all domains.
 */
export function checkAllBurnRateAlerts(): BurnRateAlert[] {
  const allAlerts: BurnRateAlert[] = [];
  for (const [, tracker] of sloTrackers) {
    allAlerts.push(...tracker.checkBurnRateAlerts());
  }
  return allAlerts;
}

// Auto-check alerts every 30 seconds
setInterval(() => {
  const alerts = checkAllBurnRateAlerts();
  if (alerts.length > 0) {
    logger.warn('SLO burn rate alerts triggered', {
      alerts: alerts.map((a) => ({
        severity: a.severity,
        domain: 'unknown', // Would need to track per tracker
        burnRate: a.burnRate,
        window: a.window,
      })),
    });
  }
}, 30_000);
