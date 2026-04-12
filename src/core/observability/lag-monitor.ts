/**
 * Worker Lag Monitor — Outbox & Projection Lag Metrics
 *
 * Tracks how far behind workers are from real-time processing.
 * Exposes Prometheus metrics and triggers alerts on excessive lag.
 *
 * Metrics:
 *   - outbox_lag_seconds: age of oldest unpublished event
 *   - outbox_pending_count: number of unpublished events
 *   - outbox_publish_rate: events published per second (5m avg)
 *   - projection_lag_seconds: age of oldest event not yet projected
 *   - worker_is_leader: 1 if this instance is the leader, 0 otherwise
 *
 * Alerts:
 *   - outbox_lag > 60s → warn
 *   - outbox_lag > 300s → critical
 *   - outbox_pending > 5000 → critical
 *
 * Usage:
 *   import { startLagMonitor, getLagMetrics } from '@/core/observability/lag-monitor';
 *
 *   // Call once at server/worker startup
 *   startLagMonitor();
 */

import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { getOutboxLeaderElection, getProjectionLeaderElection } from '@/core/infrastructure/leader-election';

// ============================================================
// Types
// ============================================================

export interface LagMetrics {
  outboxLagSeconds: number;
  outboxPendingCount: number;
  outboxPublishRate: number;       // events/sec (5m avg)
  projectionLagSeconds: number;
  outboxLeaderNodeId: string | null;
  projectionLeaderNodeId: string | null;
  isOutboxLeader: boolean;
  isProjectionLeader: boolean;
  dlqPendingCount: number;
  timestamp: string;
}

export interface LagAlert {
  level: 'warn' | 'critical';
  metric: string;
  value: number;
  threshold: number;
  message: string;
  timestamp: string;
}

// ============================================================
// Configuration
// ============================================================

interface LagMonitorConfig {
  pollIntervalMs: number;
  lagWarnThresholdSec: number;
  lagCriticalThresholdSec: number;
  pendingCriticalThreshold: number;
  onAlert?: (alert: LagAlert) => void;
}

const DEFAULT_CONFIG: LagMonitorConfig = {
  pollIntervalMs: 10_000,          // Check every 10s
  lagWarnThresholdSec: 60,         // Warn if lag > 60s
  lagCriticalThresholdSec: 300,    // Critical if lag > 5min
  pendingCriticalThreshold: 5000,  // Critical if > 5000 pending
};

// ============================================================
// State
// ============================================================

let monitorStarted = false;
let lastKnownMetrics: LagMetrics | null = null;
let lastPublishedCount = 0;
let lastPublishedAt = Date.now();
let config: LagMonitorConfig;

// ============================================================
// Lag Calculation
// ============================================================

/**
 * Get current outbox lag: age of oldest unpublished event.
 */
async function getOutboxLag(): Promise<{ lagSeconds: number; pendingCount: number; oldestPending?: Date }> {
  const result = await db.outboxEvent.findFirst({
    where: { published: false },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true },
  });

  if (!result) {
    // No pending events — lag is 0
    const count = await db.outboxEvent.count({ where: { published: false } });
    return { lagSeconds: 0, pendingCount: count };
  }

  const lagMs = Date.now() - result.createdAt.getTime();
  return {
    lagSeconds: Math.round(lagMs / 1000),
    pendingCount: 1, // At least one, we'll get exact count separately
    oldestPending: result.createdAt,
  };
}

/**
 * Get exact pending count.
 */
async function getPendingCount(): Promise<number> {
  return db.outboxEvent.count({ where: { published: false } });
}

/**
 * Get DLQ pending count.
 */
async function getDlqPendingCount(): Promise<number> {
  try {
    const { getDlqStats } = await import('@/core/outbox/dead-letter-queue');
    const stats = await getDlqStats();
    return stats.pending;
  } catch {
    return 0;
  }
}

/**
 * Estimate publish rate (events/sec) based on published events in last 5 minutes.
 */
async function getPublishRate(): Promise<number> {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  const count = await db.outboxEvent.count({
    where: {
      published: true,
      publishedAt: { gte: fiveMinutesAgo },
    },
  });
  // events per second over 5 minutes
  return Math.round((count / 300) * 100) / 100;
}

/**
 * Get projection lag: for projection worker, it's the same as outbox lag
 * since projections consume outbox events.
 */
async function getProjectionLag(outboxLag: number): Promise<number> {
  // Projection lag ≈ outbox lag + projection processing time
  // We approximate it as outbox lag since they share the same queue
  // For more accurate measurement, we'd need a separate projection_state table
  return outboxLag;
}

// ============================================================
// Alert Evaluation
// ============================================================

function evaluateAlerts(metrics: LagMetrics): LagAlert[] {
  const alerts: LagAlert[] = [];
  const now = new Date().toISOString();

  if (metrics.outboxLagSeconds >= config.lagCriticalThresholdSec) {
    alerts.push({
      level: 'critical',
      metric: 'outbox_lag_seconds',
      value: metrics.outboxLagSeconds,
      threshold: config.lagCriticalThresholdSec,
      message: `Outbox lag is ${metrics.outboxLagSeconds}s (critical threshold: ${config.lagCriticalThresholdSec}s)`,
      timestamp: now,
    });
  } else if (metrics.outboxLagSeconds >= config.lagWarnThresholdSec) {
    alerts.push({
      level: 'warn',
      metric: 'outbox_lag_seconds',
      value: metrics.outboxLagSeconds,
      threshold: config.lagWarnThresholdSec,
      message: `Outbox lag is ${metrics.outboxLagSeconds}s (warn threshold: ${config.lagWarnThresholdSec}s)`,
      timestamp: now,
    });
  }

  if (metrics.outboxPendingCount >= config.pendingCriticalThreshold) {
    alerts.push({
      level: 'critical',
      metric: 'outbox_pending_count',
      value: metrics.outboxPendingCount,
      threshold: config.pendingCriticalThreshold,
      message: `Outbox pending count is ${metrics.outboxPendingCount} (critical threshold: ${config.pendingCriticalThreshold})`,
      timestamp: now,
    });
  }

  if (metrics.dlqPendingCount > 0) {
    alerts.push({
      level: 'warn',
      metric: 'dlq_pending_count',
      value: metrics.dlqPendingCount,
      threshold: 0,
      message: `${metrics.dlqPendingCount} events in Dead Letter Queue need attention`,
      timestamp: now,
    });
  }

  return alerts;
}

// ============================================================
// Metrics Collection
// ============================================================

async function collectLagMetrics(): Promise<LagMetrics> {
  const [lagInfo, pendingCount, publishRate, dlqCount] = await Promise.all([
    getOutboxLag(),
    getPendingCount(),
    getPublishRate(),
    getDlqPendingCount(),
  ]);

  const outboxElection = getOutboxLeaderElection();
  const projectionElection = getProjectionLeaderElection();

  const metrics: LagMetrics = {
    outboxLagSeconds: lagInfo.lagSeconds,
    outboxPendingCount: pendingCount,
    outboxPublishRate: publishRate,
    projectionLagSeconds: await getProjectionLag(lagInfo.lagSeconds),
    outboxLeaderNodeId: await outboxElection.getLeader() || null,
    projectionLeaderNodeId: await projectionElection.getLeader() || null,
    isOutboxLeader: outboxElection.isLeader(),
    isProjectionLeader: projectionElection.isLeader(),
    dlqPendingCount: dlqCount,
    timestamp: new Date().toISOString(),
  };

  lastKnownMetrics = metrics;
  return metrics;
}

// ============================================================
// Prometheus Text Format
// ============================================================

/**
 * Export metrics в Prometheus text format.
 * Используется в /api/metrics endpoint.
 */
export function exportPrometheusMetrics(metrics: LagMetrics): string {
  const lines: string[] = [
    '# HELP outbox_lag_seconds Age of oldest unpublished outbox event',
    '# TYPE outbox_lag_seconds gauge',
    `outbox_lag_seconds ${metrics.outboxLagSeconds}`,
    '',
    '# HELP outbox_pending_count Number of unpublished outbox events',
    '# TYPE outbox_pending_count gauge',
    `outbox_pending_count ${metrics.outboxPendingCount}`,
    '',
    '# HELP outbox_publish_rate Outbox events published per second (5m avg)',
    '# TYPE outbox_publish_rate gauge',
    `outbox_publish_rate ${metrics.outboxPublishRate}`,
    '',
    '# HELP projection_lag_seconds Approximate projection processing lag',
    '# TYPE projection_lag_seconds gauge',
    `projection_lag_seconds ${metrics.projectionLagSeconds}`,
    '',
    '# HELP dlq_pending_count Number of events in Dead Letter Queue',
    '# TYPE dlq_pending_count gauge',
    `dlq_pending_count ${metrics.dlqPendingCount}`,
    '',
    '# HELP outbox_leader Is this instance the outbox leader (1=yes, 0=no)',
    '# TYPE outbox_leader gauge',
    `outbox_leader{node_id="${metrics.outboxLeaderNodeId || 'none'}"} ${metrics.isOutboxLeader ? 1 : 0}`,
    '',
    '# HELP projection_leader Is this instance the projection leader (1=yes, 0=no)',
    '# TYPE projection_leader gauge',
    `projection_leader{node_id="${metrics.projectionLeaderNodeId || 'none'}"} ${metrics.isProjectionLeader ? 1 : 0}`,
  ];

  return lines.join('\n');
}

// ============================================================
// Monitor
// ============================================================

/**
 * Start background lag monitoring.
 * Polls metrics, evaluates alerts, and updates lastKnownMetrics.
 */
export function startLagMonitor(userConfig?: Partial<LagMonitorConfig>): void {
  if (monitorStarted) return;

  config = { ...DEFAULT_CONFIG, ...userConfig };
  monitorStarted = true;

  logger.info('Lag monitor started', {
    pollIntervalMs: config.pollIntervalMs,
    lagWarnThresholdSec: config.lagWarnThresholdSec,
    lagCriticalThresholdSec: config.lagCriticalThresholdSec,
  });

  async function tick() {
    try {
      const metrics = await collectLagMetrics();
      const alerts = evaluateAlerts(metrics);

      if (alerts.length > 0) {
        for (const alert of alerts) {
          logger[alert.level === 'critical' ? 'error' : 'warn'](`Lag alert: ${alert.message}`, {
            metric: alert.metric,
            value: alert.value,
            threshold: alert.threshold,
          });
          config.onAlert?.(alert);
        }
      }
    } catch (err) {
      logger.error('Lag monitor tick failed', err instanceof Error ? { message: err.message } : undefined);
    }

    setTimeout(tick, config.pollIntervalMs);
  }

  tick();
}

/**
 * Get the most recent lag metrics.
 */
export function getLagMetrics(): LagMetrics | null {
  return lastKnownMetrics;
}

/**
 * Get current lag alerts.
 */
export function getLagAlerts(): LagAlert[] {
  if (!lastKnownMetrics) return [];
  return evaluateAlerts(lastKnownMetrics);
}

/**
 * Force an immediate fresh metrics collection.
 */
export async function getFreshLagMetrics(): Promise<LagMetrics> {
  return collectLagMetrics();
}
