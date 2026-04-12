/**
 * GET /api/metrics
 *
 * Prometheus-compatible metrics endpoint.
 * Exposes application-level cache metrics + health metrics.
 *
 * Scraped by Prometheus every 15s.
 */

import { NextResponse } from 'next/server';
import { generatePrometheusMetrics } from '@/lib/cache-metrics';
import { exportPrometheusMetrics, getLagMetrics } from '@/core/observability/lag-monitor';
import { getCurrentStatus } from '@/core/observability/health-tracker';

export const runtime = 'nodejs';

export async function GET() {
  let output = '';

  // Application cache metrics
  try {
    output = generatePrometheusMetrics();
  } catch (caughtError) {
    // Cache metrics not available yet
    console.error('[API] GET /api/metrics generatePrometheusMetrics error:', caughtError);
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
  output += `app_version_info{version="${process.env.npm_package_version || '1.0.0'}",node="${process.version}",platform="${process.platform}"} 1\n\n`;

  // Worker lag metrics
  try {
    const lagMetrics = getLagMetrics();
    if (lagMetrics) {
      output += exportPrometheusMetrics(lagMetrics);
    }
  } catch (err) {
    console.error('[API] GET /api/metrics lag metrics error:', err);
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
    console.error('[API] GET /api/metrics backup metrics error:', err);
  }

  return new NextResponse(output, {
    headers: {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
    },
  });
}
