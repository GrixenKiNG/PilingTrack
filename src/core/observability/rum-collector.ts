/**
 * Real User Monitoring (RUM) — PilingTrack
 *
 * Collects real-world performance metrics from users' devices.
 * Crucial for understanding performance in field conditions (3G, low-end devices).
 *
 * Metrics collected:
 * - Network type (4G/3G/2G)
 * - Effective connection type
 * - Round trip time
 * - Downlink speed
 * - Sync success rate per device
 * - Time to first sync
 * - Offline duration
 * - Error rate per network condition
 */

import { logger } from '@/lib/logger';

// ============================================================
// Configuration
// ============================================================

interface RUMConfig {
  sampleRate: number;        // 0-1, fraction of sessions to sample
  flushIntervalMs: number;   // How often to send metrics
  maxBatchSize: number;      // Max metrics per batch
}

const DEFAULT_CONFIG: RUMConfig = {
  sampleRate: 0.1,           // 10% of sessions
  flushIntervalMs: 30000,    // 30 seconds
  maxBatchSize: 50,
};

// ============================================================
// Metrics Types
// ============================================================

interface NetworkMetrics {
  effectiveType: string;     // '4g', '3g', '2g', 'slow-2g'
  rtt: number;               // Round trip time (ms)
  downlink: number;          // Bandwidth estimate (Mbps)
  saveData: boolean;         // Data saver enabled
}

interface SyncMetrics {
  totalAttempts: number;
  successfulSyncs: number;
  failedSyncs: number;
  avgSyncDurationMs: number;
  p95SyncDurationMs: number;
  conflictsDetected: number;
  conflictsResolved: number;
}

interface OfflineMetrics {
  totalOfflineDurationMs: number;
  offlineSessions: number;
  reportsCreatedOffline: number;
  syncAfterReconnect: number;
}

interface ErrorMetrics {
  totalErrors: number;
  errorsByNetwork: Record<string, number>;
  errorsByType: Record<string, number>;
}

// ============================================================
// RUM Collector
// ============================================================

class RUMCollector {
  private config: RUMConfig;
  private metrics: Array<Record<string, unknown>> = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private sessionId: string;

  constructor(config: RUMConfig = DEFAULT_CONFIG) {
    this.config = config;
    this.sessionId = this.generateSessionId();
  }

  /**
   * Initialize RUM collection.
   */
  init(): void {
    if (Math.random() > this.config.sampleRate) {
      return; // Not sampled
    }

    this.startNetworkObserver();
    this.startFlushTimer();

    logger.info('[RUM] Initialized', {
      sessionId: this.sessionId,
      sampleRate: this.config.sampleRate,
    });
  }

  /**
   * Record network metrics.
   */
  recordNetwork(): void {
    const connection = (navigator as any).connection;
    if (!connection) return;

    const metrics: NetworkMetrics = {
      effectiveType: connection.effectiveType,
      rtt: connection.rtt,
      downlink: connection.downlink,
      saveData: connection.saveData,
    };

    this.addMetric('network', metrics);
  }

  /**
   * Record sync attempt.
   */
  recordSyncAttempt(success: boolean, durationMs: number, conflict: boolean = false): void {
    const metrics: SyncMetrics = this.getMetrics<SyncMetrics>('sync') || {
      totalAttempts: 0,
      successfulSyncs: 0,
      failedSyncs: 0,
      avgSyncDurationMs: 0,
      p95SyncDurationMs: 0,
      conflictsDetected: 0,
      conflictsResolved: 0,
    };

    metrics.totalAttempts++;
    if (success) metrics.successfulSyncs++;
    else metrics.failedSyncs++;

    // Update average
    metrics.avgSyncDurationMs =
      (metrics.avgSyncDurationMs * (metrics.totalAttempts - 1) + durationMs) / metrics.totalAttempts;

    if (conflict) {
      metrics.conflictsDetected++;
      metrics.conflictsResolved++;
    }

    this.addMetric('sync', metrics);
  }

  /**
   * Record offline session.
   */
  recordOffline(durationMs: number, reportsCreated: number): void {
    const metrics: OfflineMetrics = this.getMetrics<OfflineMetrics>('offline') || {
      totalOfflineDurationMs: 0,
      offlineSessions: 0,
      reportsCreatedOffline: 0,
      syncAfterReconnect: 0,
    };

    metrics.totalOfflineDurationMs += durationMs;
    metrics.offlineSessions++;
    metrics.reportsCreatedOffline += reportsCreated;

    this.addMetric('offline', metrics);
  }

  /**
   * Record error with network context.
   */
  recordError(error: Error, networkType: string): void {
    const metrics: ErrorMetrics = this.getMetrics<ErrorMetrics>('error') || {
      totalErrors: 0,
      errorsByNetwork: {},
      errorsByType: {},
    };

    metrics.totalErrors++;
    metrics.errorsByNetwork[networkType] = (metrics.errorsByNetwork[networkType] || 0) + 1;
    metrics.errorsByType[error.name] = (metrics.errorsByType[error.name] || 0) + 1;

    this.addMetric('error', metrics);
  }

  /**
   * Flush metrics to backend.
   */
  async flush(): Promise<void> {
    if (this.metrics.length === 0) return;

    const batch = this.metrics.splice(0, this.config.maxBatchSize);

    try {
      await fetch('/api/system/rum', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: this.sessionId,
          timestamp: Date.now(),
          metrics: batch,
        }),
      });
    } catch {
      // Failed to send — metrics lost (acceptable for RUM)
      logger.warn('rum: failed to flush metrics');
    }
  }

  /**
   * Start network change observer.
   */
  private startNetworkObserver(): void {
    window.addEventListener('online', () => {
      this.recordNetwork();
    });

    window.addEventListener('offline', () => {
      this.recordNetwork();
    });

    const connection = (navigator as any).connection;
    if (connection) {
      connection.addEventListener('change', () => {
        this.recordNetwork();
      });
    }
  }

  /**
   * Start periodic flush timer.
   */
  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flush();
    }, this.config.flushIntervalMs);
  }

  /**
   * Add metric to batch.
   */
  private addMetric(type: string, data: unknown): void {
    this.metrics.push({
      type,
      data,
      timestamp: Date.now(),
    });

    // Flush if batch is full
    if (this.metrics.length >= this.config.maxBatchSize) {
      this.flush();
    }
  }

  /**
   * Get current metrics for a type.
   */
  private getMetrics<T = unknown>(type: string): T | null {
    const metric = this.metrics.find((m) => m.type === type);
    return (metric?.data as T | undefined) ?? null;
  }

  /**
   * Generate unique session ID.
   */
  private generateSessionId(): string {
    return `rum-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Stop collection and flush.
   */
  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }
}

// Singleton
export const rumCollector = new RUMCollector();

/**
 * Initialize RUM on app start.
 */
export function initRUM(): void {
  if (typeof window !== 'undefined') {
    rumCollector.init();

    // Flush on page hide
    window.addEventListener('pagehide', () => {
      rumCollector.stop();
    });
  }
}

/**
 * Helper to record sync attempt from sync engine.
 */
export function recordSyncRUM(success: boolean, durationMs: number, conflict: boolean = false): void {
  rumCollector.recordSyncAttempt(success, durationMs, conflict);
}

/**
 * Helper to record offline session.
 */
export function recordOfflineRUM(durationMs: number, reportsCreated: number): void {
  rumCollector.recordOffline(durationMs, reportsCreated);
}

/**
 * Helper to record error with network context.
 */
export function recordErrorRUM(error: Error): void {
  const connection = (navigator as any).connection;
  const networkType = connection?.effectiveType || 'unknown';
  rumCollector.recordError(error, networkType);
}
