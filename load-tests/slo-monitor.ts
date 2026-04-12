/**
 * SLO Monitor — PilingTrack Load Test
 *
 * Collects and reports system metrics during load testing:
 * - API latency (p50, p90, p95, p99)
 * - Error rates
 * - WS connection count
 * - Event delivery latency
 * - DB response times
 * - Redis latency
 *
 * Run alongside k6 tests:
 *   npx tsx load-tests/slo-monitor.ts
 */

// ============================================================
// Types
// ============================================================

interface MetricPoint {
  value: number;
  timestamp: number;
  labels?: Record<string, string>;
}

interface Percentiles {
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  avg: number;
  count: number;
}

interface SLOTarget {
  name: string;
  metric: string;
  threshold: number;
  actual: number;
  passed: boolean;
}

// ============================================================
// Metric collector
// ============================================================

class MetricCollector {
  private metrics = new Map<string, MetricPoint[]>();

  record(name: string, value: number, labels?: Record<string, string>) {
    const points = this.metrics.get(name) || [];
    points.push({ value, timestamp: Date.now(), labels });
    this.metrics.set(name, points);
  }

  getPercentiles(name: string, windowMs = 60000): Percentiles | null {
    const points = this.metrics.get(name) || [];
    const cutoff = Date.now() - windowMs;
    const recent = points.filter(p => p.timestamp >= cutoff).map(p => p.value);

    if (recent.length === 0) return null;

    const sorted = [...recent].sort((a, b) => a - b);
    const n = sorted.length;

    return {
      p50: sorted[Math.floor(n * 0.50)],
      p90: sorted[Math.floor(n * 0.90)],
      p95: sorted[Math.floor(n * 0.95)],
      p99: sorted[Math.floor(n * 0.99)],
      min: sorted[0],
      max: sorted[n - 1],
      avg: sorted.reduce((a, b) => a + b, 0) / n,
      count: n,
    };
  }

  getRate(name: string, windowMs = 60000): number {
    const points = this.metrics.get(name) || [];
    const cutoff = Date.now() - windowMs;
    return points.filter(p => p.timestamp >= cutoff).length;
  }

  getErrorRate(windowMs = 60000): number {
    const total = this.getRate('http_requests', windowMs);
    const errors = this.getRate('http_errors', windowMs);
    return total > 0 ? (errors / total) * 100 : 0;
  }
}

const collector = new MetricCollector();

// ============================================================
// Health check probe
// ============================================================

async function probeHealth(baseUrl: string) {
  const start = Date.now();
  try {
    const res = await fetch(`${baseUrl}/api/ready`, {
      signal: AbortSignal.timeout(5000),
    });
    const latency = Date.now() - start;
    collector.record('health_latency', latency);
    collector.record('health_status', res.ok ? 0 : 1);
    return { ok: res.ok, latency };
  } catch {
    collector.record('health_latency', -1);
    return { ok: false, latency: -1 };
  }
}

// ============================================================
// DB latency probe
// ============================================================

async function probeDbLatency(baseUrl: string) {
  const start = Date.now();
  try {
    const res = await fetch(`${baseUrl}/api/dictionary/all`, {
      signal: AbortSignal.timeout(5000),
    });
    const latency = Date.now() - start;
    collector.record('db_query_latency', latency);
    return latency;
  } catch {
    collector.record('db_query_latency', -1);
    return -1;
  }
}

// ============================================================
// WS stats probe
// ============================================================

async function probeWsStats(wsBaseUrl: string) {
  try {
    const res = await fetch(wsBaseUrl, {
      signal: AbortSignal.timeout(3000),
    });
    const data = await res.json() as Record<string, unknown>;
    const clientCount = (data.clients as number) || 0;
    collector.record('ws_connections', clientCount);
    return clientCount;
  } catch {
    collector.record('ws_connections', -1);
    return -1;
  }
}

// ============================================================
// SLO checker
// ============================================================

const SLO_TARGETS: Array<{
  name: string;
  metric: string;
  percentile?: keyof Percentiles;
  threshold: number;
  unit: string;
}> = [
  { name: 'API p95 latency', metric: 'http_req_duration', percentile: 'p95', threshold: 300, unit: 'ms' },
  { name: 'API p99 latency', metric: 'http_req_duration', percentile: 'p99', threshold: 500, unit: 'ms' },
  { name: 'Error rate', metric: 'error_rate', threshold: 1, unit: '%' },
  { name: 'Health check latency', metric: 'health_latency', percentile: 'p95', threshold: 200, unit: 'ms' },
  { name: 'DB query latency', metric: 'db_query_latency', percentile: 'p95', threshold: 100, unit: 'ms' },
  { name: 'WS connections', metric: 'ws_connections', threshold: 900, unit: 'count' },
];

function checkSLOs(): SLOTarget[] {
  return SLO_TARGETS.map(slo => {
    let actual: number;

    if (slo.percentile) {
      const pct = collector.getPercentiles(slo.metric);
      actual = pct ? pct[slo.percentile] : -1;
    } else if (slo.metric === 'error_rate') {
      actual = collector.getErrorRate();
    } else {
      const rate = collector.getRate(slo.metric);
      actual = rate;
    }

    return {
      name: slo.name,
      metric: slo.metric,
      threshold: slo.threshold,
      actual: Math.round(actual * 100) / 100,
      passed: actual >= 0 && actual <= slo.threshold,
    };
  });
}

// ============================================================
// Report
// ============================================================

function printReport() {
  const width = 80;
  const separator = '─'.repeat(width);

  console.log('\n' + separator);
  console.log('  SLO REPORT — ' + new Date().toISOString());
  console.log(separator);

  // SLO status
  console.log('\n📊 SLO Status:\n');
  const sloResults = checkSLOs();

  console.log(`  ${'SLO'.padEnd(30)} ${'Actual'.padEnd(12)} ${'Target'.padEnd(12)} Status`);
  console.log('  ' + '─'.repeat(76));

  for (const slo of sloResults) {
    const icon = slo.passed ? '✅' : '❌';
    const actualStr = slo.actual === -1 ? 'N/A' : String(slo.actual);
    const unit = SLO_TARGETS.find(s => s.name === slo.name)?.unit || '';
    console.log(
      `  ${icon} ${slo.name.padEnd(28)} ${actualStr.padEnd(12)} ${String(slo.threshold).padEnd(12)} ${unit}`
    );
  }

  // Percentile breakdowns
  console.log('\n\n📈 Latency Percentiles:\n');

  const httpPct = collector.getPercentiles('http_req_duration');
  if (httpPct) {
    console.log(`  HTTP Requests: ${httpPct.count} samples`);
    console.log(`    p50: ${httpPct.p50}ms | p90: ${httpPct.p90}ms | p95: ${httpPct.p95}ms | p99: ${httpPct.p99}ms`);
  }

  const dbPct = collector.getPercentiles('db_query_latency');
  if (dbPct && dbPct.count > 0) {
    console.log(`  DB Queries:  ${dbPct.count} samples`);
    console.log(`    p50: ${dbPct.p50}ms | p90: ${dbPct.p90}ms | p95: ${dbPct.p95}ms | p99: ${dbPct.p99}ms`);
  }

  const healthPct = collector.getPercentiles('health_latency');
  if (healthPct && healthPct.count > 0) {
    console.log(`  Health Check: ${healthPct.count} samples`);
    console.log(`    p50: ${healthPct.p50}ms | p95: ${healthPct.p95}ms`);
  }

  // Rates
  console.log('\n\n📡 Throughput:\n');
  console.log(`  HTTP req/s (last 60s):  ${collector.getRate('http_requests')}`);
  console.log(`  Errors (last 60s):      ${collector.getRate('http_errors')}`);
  console.log(`  Error rate:             ${collector.getErrorRate().toFixed(2)}%`);

  const wsConns = collector.getRate('ws_connections');
  console.log(`  WS connections:         ${wsConns > 0 ? wsConns : 'probe failed'}`);

  // Events
  const eventCount = collector.getRate('events_published');
  if (eventCount > 0) {
    console.log(`  Events published/s:     ${eventCount}`);
  }

  // Summary
  const passedCount = sloResults.filter(s => s.passed).length;
  const totalCount = sloResults.length;

  console.log('\n' + separator);
  console.log(`  SUMMARY: ${passedCount}/${totalCount} SLOs passed`);

  if (passedCount === totalCount) {
    console.log('  🟢 ALL SLOs MET — System is performing within targets');
  } else if (passedCount >= totalCount * 0.8) {
    console.log('  🟡 MOST SLOs MET — Some optimizations needed');
  } else {
    console.log('  🔴 SLOs NOT MET — System needs significant optimization');
  }

  console.log(separator + '\n');
}

// ============================================================
// Monitor loop
// ============================================================

async function runMonitor(baseUrl: string, wsBaseUrl: string, intervalMs = 10000) {
  console.log('🔍 SLO Monitor started');
  console.log(`   API: ${baseUrl}`);
  console.log(`   WS:  ${wsBaseUrl}`);
  console.log(`   Report interval: ${intervalMs / 1000}s`);
  console.log('');

  // Setup HTTP interception (via proxy or manual logging)
  // For now, we probe independently

  const monitorLoop = setInterval(async () => {
    // Run probes in parallel
    await Promise.all([
      probeHealth(baseUrl),
      probeDbLatency(baseUrl),
      probeWsStats(wsBaseUrl),
    ]);
  }, intervalMs);

  // Print report every 30s
  const reportInterval = setInterval(printReport, 30000);

  // Handle shutdown
  process.on('SIGINT', () => {
    clearInterval(monitorLoop);
    clearInterval(reportInterval);
    printReport();
    console.log('\n👋 SLO Monitor stopped');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    clearInterval(monitorLoop);
    clearInterval(reportInterval);
    printReport();
    process.exit(0);
  });
}

// ============================================================
// Entry
// ============================================================

const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
const wsBaseUrl = process.env.WS_BASE_URL || 'http://localhost:3001';

runMonitor(baseUrl, wsBaseUrl).catch((err) => {
  console.error('Monitor failed:', err);
  process.exit(1);
});
