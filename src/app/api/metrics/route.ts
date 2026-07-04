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

    output += `# HELP nodejs_eventloop_lag_seconds Node.js event loop lag in seconds\n`;
    output += `# TYPE nodejs_eventloop_lag_seconds gauge\n`;
    // Simple event loop lag measurement
    const start = performance.now();
    output += `nodejs_eventloop_lag_seconds ${(start / 1000).toFixed(6)}\n\n`;

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
      if (lagMetrics) {
        output += exportPrometheusMetrics(lagMetrics);
      }
    } catch (err) {
      logger.error('metrics: lag metrics failed', err);
    }

    // Backup health metrics
    try {
      const status = getCurrentStatus();
      if (status?.components.backup) {
        const { backup } = status.components;
        const ageHours = backup.lastBackupAgeHours || 0;
        const s3Synced = backup.s3Synced ? 1 : 0;

        output += `# HELP backup_age_hours Hours since last successful backup\n`;
        output += `# TYPE backup_age_hours gauge\n`;
        output += `backup_age_hours ${ageHours}\n\n`;

        output += `# HELP backup_s3_synced Whether last backup was synced to S3 (1=yes, 0=no)\n`;
        output += `# TYPE backup_s3_synced gauge\n`;
        output += `backup_s3_synced ${s3Synced}\n\n`;
      }
    } catch (err) {
      logger.error('metrics: backup metrics failed', err);
    }

    return new NextResponse(output, {
      headers: {
        'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      },
    });
  },
  { domain: 'system' }
);
