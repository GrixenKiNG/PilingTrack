/**
 * GET /api/metrics
 *
 * Prometheus-compatible metrics endpoint.
 * Exposes application-level cache metrics + health metrics.
 *
 * Scraped by Prometheus every 15s.
 */

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { generatePrometheusMetrics } from '@/lib/cache-metrics';
import { exportPrometheusMetrics, getLagMetrics } from '@/core/observability/lag-monitor';
import { getCurrentStatus } from '@/core/observability/health-tracker';
import { getEventLoopLagSeconds, resetEventLoopLag } from '@/core/observability/event-loop-lag';
import { exportHttpMetricsPrometheus } from '@/core/observability/http-metrics';
import { exportAuditFeedbackMetricsPrometheus } from '@/core/observability/audit-feedback-metrics';
import { withApi } from '@/core/api-wrapper';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

// Constant-time string comparison to prevent a timing side-channel on the
// shared-secret token (mirrors auth-service.ts's / alerts/webhook's
// constantTimeEquals — same secret-comparison class of bug).
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// Prometheus's static scrape_configs can't do a session login (no cookie
// jar, no JWT refresh) — this endpoint needs its own service-to-service
// credential separate from user auth. Fails closed: unset
// METRICS_SCRAPE_TOKEN or any non-matching header means "not authorized via
// token," falling through to the existing session-based check below (so a
// logged-in admin can still open /api/metrics in a browser to debug).
function isValidScrapeToken(request: NextRequest): boolean {
  const expected = process.env.METRICS_SCRAPE_TOKEN;
  if (!expected) return false;
  const header = request.headers.get('authorization');
  const bearer = header?.startsWith('Bearer ') ? header.slice(7) : null;
  return !!bearer && constantTimeEquals(bearer, expected);
}

export const GET = withApi(
  async (request: NextRequest) => {
    if (!isValidScrapeToken(request)) {
      const { user, error } = await requireAuth(request);
      if (error) return error;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
      assertCan(user!, 'system.read');
    }
    let output = '';

    // Application cache metrics
    try {
      output = generatePrometheusMetrics();
    } catch (caughtError) {
      // Cache metrics not available yet
      logger.error('metrics: cache metrics unavailable', caughtError);
      output = '# No cache metrics available yet\n';
    }

    // Process metrics
    const memUsage = process.memoryUsage();
    output += `# HELP process_resident_memory_bytes Resident memory size in bytes\n`;
    output += `# TYPE process_resident_memory_bytes gauge\n`;
    output += `process_resident_memory_bytes ${memUsage.rss}\n\n`;

    output += `# HELP process_heap_bytes Node.js heap size in bytes\n`;
    output += `# TYPE process_heap_bytes gauge\n`;
    output += `process_heap_bytes ${memUsage.heapTotal}\n\n`;

    output += `# HELP process_heap_used_bytes Node.js heap used in bytes\n`;
    output += `# TYPE process_heap_used_bytes gauge\n`;
    output += `process_heap_used_bytes ${memUsage.heapUsed}\n\n`;

    output += `# HELP nodejs_eventloop_lag_seconds Mean event loop delay in seconds since the last scrape\n`;
    output += `# TYPE nodejs_eventloop_lag_seconds gauge\n`;
    output += `nodejs_eventloop_lag_seconds ${getEventLoopLagSeconds().toFixed(6)}\n\n`;
    // Reset after reading so the next scrape reflects the interval since
    // this one, not an all-time average that flattens out over days.
    resetEventLoopLag();

    // Uptime
    output += `# HELP process_uptime_seconds Process uptime in seconds\n`;
    output += `# TYPE process_uptime_seconds counter\n`;
    output += `process_uptime_seconds ${process.uptime()}\n\n`;

    // Version info
    output += `# HELP app_version_info Application version info\n`;
    output += `# TYPE app_version_info gauge\n`;
    output += `app_version_info{version="${process.env.APP_VERSION || process.env.npm_package_version || '1.0.0'}",node="${process.version}",platform="${process.platform}"} 1\n\n`;

    // Worker lag metrics
    try {
      const lagMetrics = getLagMetrics();
      output += exportPrometheusMetrics(lagMetrics);
    } catch (err) {
      logger.error('metrics: lag metrics failed', err);
    }

    // Снимок фонового health-трекера и состояние резервных копий
    try {
      const status = getCurrentStatus();
      const timestamp = status ? Date.parse(status.timestamp) : NaN;
      const snapshotAge = Number.isFinite(timestamp) ? Math.max(0, (Date.now() - timestamp) / 1000) : -1;
      const healthStatus = !status ? -1 : status.status === 'healthy' ? 0 : status.status === 'degraded' ? 1 : 2;

      output += `# HELP health_status Cached system status (-1=unavailable, 0=healthy, 1=degraded, 2=unhealthy)\n`;
      output += `# TYPE health_status gauge\n`;
      output += `health_status ${healthStatus}\n\n`;
      output += `# HELP health_snapshot_age_seconds Age of cached health snapshot (-1=unavailable)\n`;
      output += `# TYPE health_snapshot_age_seconds gauge\n`;
      output += `health_snapshot_age_seconds ${snapshotAge}\n\n`;
      if (status?.components.backup) {
        const { backup } = status.components;
        const available = Number.isFinite(backup.lastBackupAgeHours) && (backup.lastBackupAgeHours ?? -1) >= 0;
        const ageHours = available ? (backup.lastBackupAgeHours ?? 0) : 0;
        output += `# HELP backup_monitoring_enabled Whether backup monitoring is enabled\n`;
        output += `# TYPE backup_monitoring_enabled gauge\n`;
        output += `backup_monitoring_enabled ${backup.source === 'disabled' ? 0 : 1}\n\n`;
        output += `# HELP backup_last_success_available Whether a valid last successful backup age is available\n`;
        output += `# TYPE backup_last_success_available gauge\n`;
        output += `backup_last_success_available ${available ? 1 : 0}\n\n`;
        const s3Synced = backup.s3Synced ? 1 : 0;

        output += `# HELP backup_age_hours Hours since last successful backup\n`;
        output += `# TYPE backup_age_hours gauge\n`;
        output += `backup_age_hours ${ageHours}\n\n`;

        output += `# HELP backup_s3_synced Whether last backup was synced to S3 (1=yes, 0=no)\n`;
        output += `# TYPE backup_s3_synced gauge\n`;
        output += `backup_s3_synced ${s3Synced}\n\n`;
      }
    } catch (err) {
      logger.error('metrics: health and backup metrics failed', err);
    }

    // HTTP request metrics (recorded centrally in withApi/withMutation —
    // audit #9: alerts.yml referenced these but nothing ever created them).
    try {
      output += exportHttpMetricsPrometheus();
    } catch (err) {
      logger.error('metrics: http metrics failed', err);
    }

    output += exportAuditFeedbackMetricsPrometheus();

    return new NextResponse(output, {
      headers: {
        'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      },
    });
  },
  { domain: 'system' }
);
