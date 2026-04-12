/**
 * Cache Metrics for Prometheus
 *
 * Exposes application-level cache metrics via Prometheus client.
 * Reads from cache-strategies.ts which tracks all cache operations.
 *
 * Metrics:
 * - cache_hits_total
 * - cache_misses_total
 * - cache_stale_hits_total
 * - cache_stampedes_total
 * - cache_writes_total
 * - cache_deletions_total
 * - cache_operations_duration_seconds
 * - cache_hit_rate
 */

import { cacheStats as strategiesStats } from './cache-strategies';

// ============================================================
// Metric counters (in-memory, exported via /api/metrics)
// ============================================================

interface MetricValue {
  count: number;
  latencies: number[];
}

const metrics: Record<string, MetricValue> = {
  cache_hits: { count: 0, latencies: [] },
  cache_misses: { count: 0, latencies: [] },
  cache_stale_hits: { count: 0, latencies: [] },
  cache_stampedes: { count: 0, latencies: [] },
  cache_writes: { count: 0, latencies: [] },
  cache_deletions: { count: 0, latencies: [] },
};

// ============================================================
// Recording Functions
// ============================================================

export function recordCacheHit(latencyMs?: number): void {
  metrics.cache_hits.count++;
  if (latencyMs !== undefined) metrics.cache_hits.latencies.push(latencyMs);
}

export function recordCacheMiss(latencyMs?: number): void {
  metrics.cache_misses.count++;
  if (latencyMs !== undefined) metrics.cache_misses.latencies.push(latencyMs);
}

export function recordStaleHit(latencyMs?: number): void {
  metrics.cache_stale_hits.count++;
  if (latencyMs !== undefined) metrics.cache_stale_hits.latencies.push(latencyMs);
}

export function recordStampede(): void {
  metrics.cache_stampedes.count++;
}

export function recordWrite(latencyMs?: number): void {
  metrics.cache_writes.count++;
  if (latencyMs !== undefined) metrics.cache_writes.latencies.push(latencyMs);
}

export function recordDeletion(): void {
  metrics.cache_deletions.count++;
}

export function recordOperation(operation: string, latencyMs?: number): void {
  const key = `cache_${operation}`;
  if (!metrics[key]) {
    metrics[key] = { count: 0, latencies: [] };
  }
  metrics[key].count++;
  if (latencyMs !== undefined) metrics[key].latencies.push(latencyMs);
}

// ============================================================
// Prometheus Text Format Generator
//
// Output format for /api/metrics endpoint
// ============================================================

export function generatePrometheusMetrics(): string {
  const s = strategiesStats;

  let output = '# HELP cache_hits_total Total number of cache hits\n';
  output += '# TYPE cache_hits_total counter\n';
  output += `cache_hits_total ${s.hits}\n\n`;

  output += '# HELP cache_misses_total Total number of cache misses\n';
  output += '# TYPE cache_misses_total counter\n';
  output += `cache_misses_total ${s.misses}\n\n`;

  output += '# HELP cache_stale_hits_total Total number of stale cache hits (SWR)\n';
  output += '# TYPE cache_stale_hits_total counter\n';
  output += `cache_stale_hits_total ${s.staleHits}\n\n`;

  output += '# HELP cache_stampedes_total Total number of cache stampedes\n';
  output += '# TYPE cache_stampedes_total counter\n';
  output += `cache_stampedes_total ${s.stampedes}\n\n`;

  output += '# HELP cache_writes_total Total number of cache writes\n';
  output += '# TYPE cache_writes_total counter\n';
  output += `cache_writes_total ${s.writes}\n\n`;

  output += '# HELP cache_deletions_total Total number of cache deletions\n';
  output += '# TYPE cache_deletions_total counter\n';
  output += `cache_deletions_total ${s.deletions}\n\n`;

  // Cache hit rate (computed metric)
  const total = s.hits + s.misses;
  const hitRate = total > 0 ? s.hits / total : 0;
  output += '# HELP cache_hit_rate Cache hit rate (0-1)\n';
  output += '# TYPE cache_hit_rate gauge\n';
  output += `cache_hit_rate ${hitRate.toFixed(6)}\n\n`;

  return output;
}

// ============================================================
// API Route Handler
//
// Usage: Create /app/api/metrics/route.ts with:
//
//   import { NextResponse } from 'next/server';
//   import { generatePrometheusMetrics } from '@/lib/cache-metrics';
//
//   export async function GET() {
//     return new NextResponse(generatePrometheusMetrics(), {
//       headers: { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' },
//     });
//   }
// ============================================================

export function createMetricsResponse(): Response {
  return new Response(generatePrometheusMetrics(), {
    headers: {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
    },
  });
}
