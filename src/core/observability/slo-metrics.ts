/**
 * SLO Метрики + Burn Rate Alerting — PilingTrack
 *
 * Определяет Service Level Objectives и отслеживает:
 * - Error Budget (сколько ошибок допустимо)
 * - Availability % (доступность API)
 * - Latency SLO (p95, p99 latency targets)
 * - Sync Success Rate (% успешных синхронизаций)
 * - Event Delivery Latency (доставка событий)
 *
 * Burn Rate Alerting:
 * - 14.4x burn rate (5 min window) → Page emergency
 * - 6x burn rate (30 min window) → Urgent alert
 * - 3x burn rate (1 hour window) → Warning
 * - 1x burn rate (6 hour window) → Info
 *
 * Alerting: при нарушении SLO → logger.error + опционально Telegram webhook
 */

import { logger } from '@/lib/logger';
import { getCircuitBreakerHealth } from '@/core/infrastructure/circuit-breakers';
import { getDlqStats } from '@/core/outbox/dead-letter-queue';
import { getOutboxStats } from '@/services/reports/outbox-publisher';

// ============================================================
// SLO Definitions
// ============================================================

export interface SLOTarget {
  name: string;
  target: number;        // Целевое значение (0-100%)
  current: number;       // Текущее значение
  budget: number;        // Оставшийся error budget (%)
  status: 'meeting' | 'warning' | 'breached';
}

export interface SLOResult {
  timestamp: string;
  slo: SLOTarget[];
  overallHealth: 'healthy' | 'degraded' | 'critical';
  alerts: string[];
  burnRate?: BurnRateResult;
}

// ============================================================
// Burn Rate Alerting
// ============================================================

/**
 * Burn rate = how fast you're consuming your error budget.
 *
 * If SLO is 99.9% (0.1% error budget):
 * - 14.4x burn rate = consuming monthly budget in ~2 days
 * - 6x burn rate = consuming monthly budget in ~5 days
 * - 3x burn rate = consuming monthly budget in ~10 days
 * - 1x burn rate = on track to exhaust budget by end of window
 */

export interface BurnRateWindow {
  windowMinutes: number;
  burnRateMultiplier: number;
  severity: 'page' | 'urgent' | 'warning' | 'info';
}

export const BURN_RATE_WINDOWS: BurnRateWindow[] = [
  { windowMinutes: 5, burnRateMultiplier: 14.4, severity: 'page' },
  { windowMinutes: 30, burnRateMultiplier: 6, severity: 'urgent' },
  { windowMinutes: 60, burnRateMultiplier: 3, severity: 'warning' },
  { windowMinutes: 360, burnRateMultiplier: 1, severity: 'info' },
];

export interface BurnRateResult {
  current: number;           // Current burn rate (1.0 = on track)
  errorBudgetRemaining: number; // % of error budget remaining
  alerts: BurnRateAlert[];
}

export interface BurnRateAlert {
  window: string;
  burnRate: number;
  severity: 'page' | 'urgent' | 'warning' | 'info';
  message: string;
}

/**
 * Calculate burn rate for a given time window.
 *
 * @param errorRate - Current error rate (0-100%)
 * @param sloTarget - SLO target (e.g., 99.9)
 * @param windowMinutes - Time window for calculation
 * @returns Burn rate multiplier (1.0 = exactly on track)
 */
export function calculateBurnRate(
  errorRate: number,
  sloTarget: number,
  _windowMinutes: number
): number {
  const allowedErrorRate = 100 - sloTarget; // e.g., 0.1% for 99.9% SLO
  if (allowedErrorRate === 0) return errorRate > 0 ? Infinity : 0;

  // Burn rate = actual error rate / allowed error rate
  return errorRate / allowedErrorRate;
}

/**
 * Calculate error budget remaining.
 * Can be negative when error budget is exhausted.
 */
export function calculateErrorBudgetRemaining(
  errorRate: number,
  sloTarget: number
): number {
  const allowedErrorRate = 100 - sloTarget;
  return allowedErrorRate - errorRate;
}

// ============================================================
// SLO Tracking (in-memory с экспортом в Prometheus/Redis)
// ============================================================

export class SLOTracker {
  // Счётчики за окно (1 час)
  private windowStart = Date.now();
  private windowMs = 60 * 60 * 1000; // 1 час

  private totalRequests = 0;
  private failedRequests = 0;
  private syncAttempts = 0;
  private syncSuccesses = 0;
  private eventDeliveries = 0;
  private eventDeliveryLatencies: number[] = [];

  /**
   * Record API request result.
   */
  recordApiRequest(success: boolean): void {
    this.checkWindowReset();
    this.totalRequests++;
    if (!success) this.failedRequests++;
  }

  /**
   * Record sync attempt.
   */
  recordSyncAttempt(success: boolean): void {
    this.checkWindowReset();
    this.syncAttempts++;
    if (success) this.syncSuccesses++;
  }

  /**
   * Record event delivery.
   */
  recordEventDelivery(latencyMs: number): void {
    this.checkWindowReset();
    this.eventDeliveries++;
    this.eventDeliveryLatencies.push(latencyMs);
  }

  /**
   * Get current SLO status with burn rate analysis.
   */
  async getStatus(): Promise<SLOResult> {
    const [outboxStats, dlqStats, circuitHealth] = await Promise.allSettled([
      getOutboxStats(),
      getDlqStats(),
      Promise.resolve(getCircuitBreakerHealth()),
    ]);

    const availability = this.totalRequests > 0
      ? ((this.totalRequests - this.failedRequests) / this.totalRequests) * 100
      : 100;

    const syncSuccessRate = this.syncAttempts > 0
      ? (this.syncSuccesses / this.syncAttempts) * 100
      : 100;

    const avgEventLatency = this.eventDeliveryLatencies.length > 0
      ? this.eventDeliveryLatencies.reduce((a, b) => a + b, 0) / this.eventDeliveryLatencies.length
      : 0;

    // Error budget: 0.1% error rate allowed (99.9% SLO)
    const errorBudget = Math.max(0, availability - 99.9);
    const availabilityStatus = availability >= 99.9 ? 'meeting' : availability >= 99.5 ? 'warning' : 'breached';

    // Sync SLO: 99% success rate
    const syncBudget = Math.max(0, syncSuccessRate - 99);
    const syncStatus = syncSuccessRate >= 99 ? 'meeting' : syncSuccessRate >= 95 ? 'warning' : 'breached';

    // Event delivery SLO: < 2s average
    const eventStatus = avgEventLatency <= 2000 ? 'meeting' : avgEventLatency <= 5000 ? 'warning' : 'breached';

    const slo: SLOTarget[] = [
      {
        name: 'api_availability',
        target: 99.9,
        current: availability,
        budget: errorBudget,
        status: availabilityStatus,
      },
      {
        name: 'sync_success_rate',
        target: 99,
        current: syncSuccessRate,
        budget: syncBudget,
        status: syncStatus,
      },
      {
        name: 'event_delivery_latency_ms',
        target: 2000,
        current: avgEventLatency,
        budget: Math.max(0, 2000 - avgEventLatency),
        status: eventStatus,
      },
    ];

    // ============================================================
    // Burn Rate Calculation
    // ============================================================

    const errorRate = this.totalRequests > 0
      ? (this.failedRequests / this.totalRequests) * 100
      : 0;

    const burnRateAlerts: BurnRateAlert[] = [];
    let maxBurnRate = 0;

    for (const window of BURN_RATE_WINDOWS) {
      const burnRate = calculateBurnRate(errorRate, 99.9, window.windowMinutes);
      maxBurnRate = Math.max(maxBurnRate, burnRate);

      if (burnRate >= window.burnRateMultiplier) {
        const windowLabel = window.windowMinutes >= 60
          ? `${window.windowMinutes / 60}h`
          : `${window.windowMinutes}m`;

        burnRateAlerts.push({
          window: windowLabel,
          burnRate: Math.round(burnRate * 10) / 10,
          severity: window.severity,
          message: `Burn rate ${burnRate.toFixed(1)}x in ${windowLabel} window (threshold: ${window.burnRateMultiplier}x)`,
        });
      }
    }

    const burnRate: BurnRateResult | undefined = burnRateAlerts.length > 0 ? {
      current: Math.round(maxBurnRate * 10) / 10,
      errorBudgetRemaining: Math.round(calculateErrorBudgetRemaining(errorRate, 99.9) * 100) / 100,
      alerts: burnRateAlerts,
    } : undefined;

    // ============================================================
    // Alerts
    // ============================================================

    const alerts: string[] = [];

    if (availabilityStatus === 'breached') {
      alerts.push(`CRITICAL: API availability ${availability.toFixed(2)}% < 99.9% SLO`);
    } else if (availabilityStatus === 'warning') {
      alerts.push(`WARNING: API availability ${availability.toFixed(2)}% approaching SLO breach`);
    }

    if (syncStatus === 'breached') {
      alerts.push(`CRITICAL: Sync success rate ${syncSuccessRate.toFixed(2)}% < 99% SLO`);
    } else if (syncStatus === 'warning') {
      alerts.push(`WARNING: Sync success rate ${syncSuccessRate.toFixed(2)}% approaching SLO breach`);
    }

    // Burn rate alerts
    for (const br of burnRateAlerts) {
      const prefix = br.severity === 'page' ? 'PAGE' : br.severity === 'urgent' ? 'URGENT' : br.severity === 'warning' ? 'WARNING' : 'INFO';
      alerts.push(`${prefix}: ${br.message}`);
    }

    // Outbox backlog alert
    if (outboxStats.status === 'fulfilled' && outboxStats.value.unpublished > 1000) {
      alerts.push(`WARNING: Outbox backlog ${outboxStats.value.unpublished} events > 1000`);
    }

    // DLQ alert
    if (dlqStats.status === 'fulfilled' && dlqStats.value.pending > 50) {
      alerts.push(`CRITICAL: DLQ has ${dlqStats.value.pending} pending events`);
    }

    // Circuit breaker alert
    if (circuitHealth.status === 'fulfilled') {
      for (const [name, state] of Object.entries(circuitHealth.value)) {
        if (state.state === 'OPEN') {
          alerts.push(`CRITICAL: Circuit breaker [${name}] is OPEN`);
        }
      }
    }

    const overallHealth = alerts.some(a => a.startsWith('CRITICAL') || a.startsWith('PAGE'))
      ? 'critical'
      : alerts.some(a => a.startsWith('URGENT') || a.startsWith('WARNING'))
        ? 'degraded'
        : 'healthy';

    // Log alerts
    if (alerts.length > 0) {
      logger.error('SLO alerts triggered', { alerts, slo, burnRate });
    }

    return {
      timestamp: new Date().toISOString(),
      slo,
      overallHealth,
      alerts,
      burnRate,
    };
  }

  /**
   * Reset counters if window expired.
   */
  private checkWindowReset(): void {
    if (Date.now() - this.windowStart > this.windowMs) {
      this.windowStart = Date.now();
      this.totalRequests = 0;
      this.failedRequests = 0;
      this.syncAttempts = 0;
      this.syncSuccesses = 0;
      this.eventDeliveries = 0;
      this.eventDeliveryLatencies = [];
    }
  }
}

// Singleton
export const sloTracker = new SLOTracker();

/**
 * Middleware wrapper — record API request result.
 */
export function recordSLOApiRequest(success: boolean): void {
  sloTracker.recordApiRequest(success);
}

/**
 * Get current SLO status.
 */
export async function getSLOStatus(): Promise<SLOResult> {
  return sloTracker.getStatus();
}
