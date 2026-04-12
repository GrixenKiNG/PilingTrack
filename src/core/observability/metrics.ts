/**
 * Prometheus Metrics — Production Observability
 *
 * Metrics exposed at GET /api/metrics (Prometheus scrape format).
 *
 * Metrics:
 * - http_request_duration_seconds (Histogram)
 * - http_requests_total (Counter by method, path, status)
 * - error_rate_total (Counter)
 * - report_create_total (Counter)
 * - active_users (Gauge)
 * - db_query_duration_seconds (Histogram)
 *
 * Usage:
 *   import { metricsMiddleware, getMetricsResponse } from '@/core/observability/metrics';
 *   // In API route: await metricsMiddleware(request, response);
 *   // Metrics endpoint: return getMetricsResponse();
 */

// ============================================================
// Metric Types
// ============================================================

interface MetricSample {
  labels: Record<string, string>;
  value: number;
}

interface MetricDefinition {
  name: string;
  help: string;
  type: 'counter' | 'gauge' | 'histogram';
  samples: MetricSample[];
}

const metrics = new Map<string, MetricDefinition>();

function getOrCreateMetric(
  name: string,
  help: string,
  type: 'counter' | 'gauge' | 'histogram'
): MetricDefinition {
  if (!metrics.has(name)) {
    metrics.set(name, { name, help, type, samples: [] });
  }
  return metrics.get(name)!;
}

// ============================================================
// Counter
// ============================================================

export function counterInc(name: string, value = 1, labels: Record<string, string> = {}) {
  const metric = getOrCreateMetric(name, name, 'counter');
  const key = JSON.stringify(labels);
  const existing = metric.samples.find(s => JSON.stringify(s.labels) === key);
  if (existing) {
    existing.value += value;
  } else {
    metric.samples.push({ labels, value });
  }
}

// ============================================================
// Gauge
// ============================================================

export function gaugeSet(name: string, value: number, labels: Record<string, string> = {}) {
  const metric = getOrCreateMetric(name, name, 'gauge');
  const key = JSON.stringify(labels);
  const existing = metric.samples.find(s => JSON.stringify(s.labels) === key);
  if (existing) {
    existing.value = value;
  } else {
    metric.samples.push({ labels, value });
  }
}

export function gaugeInc(name: string, labels: Record<string, string> = {}) {
  const metric = getOrCreateMetric(name, name, 'gauge');
  const key = JSON.stringify(labels);
  const existing = metric.samples.find(s => JSON.stringify(s.labels) === key);
  const current = existing?.value || 0;
  if (existing) {
    existing.value = current + 1;
  } else {
    metric.samples.push({ labels, value: current + 1 });
  }
}

export function gaugeDec(name: string, labels: Record<string, string> = {}) {
  const metric = getOrCreateMetric(name, name, 'gauge');
  const key = JSON.stringify(labels);
  const existing = metric.samples.find(s => JSON.stringify(s.labels) === key);
  const current = existing?.value || 0;
  if (existing) {
    existing.value = current - 1;
  } else {
    metric.samples.push({ labels, value: current - 1 });
  }
}

// ============================================================
// Histogram
// ============================================================

const HISTOGRAM_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export function histogramObserve(name: string, value: number, labels: Record<string, string> = {}) {
  const metric = getOrCreateMetric(name, name, 'histogram');

  // Store as individual samples for each bucket
  for (const bucket of HISTOGRAM_BUCKETS) {
    const bucketLabels = { ...labels, le: String(bucket) };
    const existing = metric.samples.find(
      s => JSON.stringify(s.labels) === JSON.stringify(bucketLabels)
    );
    if (!existing) {
      metric.samples.push({ labels: bucketLabels, value: value <= bucket ? 1 : 0 });
    } else if (value <= bucket) {
      existing.value += 1;
    }
  }

  // +Inf bucket
  const infLabels = { ...labels, le: '+Inf' };
  const infSample = metric.samples.find(s => JSON.stringify(s.labels) === JSON.stringify(infLabels));
  if (!infSample) {
    metric.samples.push({ labels: infLabels, value: 1 });
  } else {
    infSample.value += 1;
  }

  // Sum
  const sumLabels = { ...labels, __sum: 'true' };
  const sumSample = metric.samples.find(s => JSON.stringify(s.labels) === JSON.stringify(sumLabels));
  if (!sumSample) {
    metric.samples.push({ labels: sumLabels, value });
  } else {
    sumSample.value += value;
  }

  // Count
  const countLabels = { ...labels, __count: 'true' };
  const countSample = metric.samples.find(s => JSON.stringify(s.labels) === JSON.stringify(countLabels));
  if (!countSample) {
    metric.samples.push({ labels: countLabels, value: 1 });
  } else {
    countSample.value += 1;
  }
}

// ============================================================
// Pre-defined Metrics
// ============================================================

// HTTP request duration
export function observeHttpRequestDuration(
  method: string,
  path: string,
  statusCode: number,
  durationSeconds: number
) {
  histogramObserve('http_request_duration_seconds', durationSeconds, {
    method,
    path,
    status: String(statusCode),
  });
}

// HTTP request count
export function countHttpRequest(method: string, path: string, statusCode: number) {
  counterInc('http_requests_total', 1, {
    method,
    path,
    status: String(statusCode),
  });
}

// Error count
export function countError(component: string, errorType: string) {
  counterInc('error_rate_total', 1, { component, error_type: errorType });
}

// Report creation count
export function countReportCreate(status: 'success' | 'failed' | 'validation_error') {
  counterInc('report_create_total', 1, { status });
}

// Active users gauge
export function setActiveUsers(count: number) {
  gaugeSet('active_users', count);
}

// DB query duration
export function observeDbQueryDuration(operation: string, durationSeconds: number) {
  histogramObserve('db_query_duration_seconds', durationSeconds, { operation });
}

// Outbox events
export function countOutboxEvent(type: string, status: 'processed' | 'failed' | 'retried') {
  counterInc('outbox_events_total', 1, { type, status });
}

// ============================================================
// Prometheus Format Export
// ============================================================

function formatLabels(labels: Record<string, string>): string {
  if (Object.keys(labels).length === 0) return '';
  const parts = Object.entries(labels)
    .filter(([k]) => !k.startsWith('__'))
    .map(([k, v]) => `${k}="${v}"`);
  return parts.length > 0 ? `{${parts.join(',')}}` : '';
}

export function getMetricsResponse(): string {
  const lines: string[] = [];

  for (const metric of metrics.values()) {
    // Skip internal markers
    const realSamples = metric.samples.filter(
      s => !Object.keys(s.labels).some(k => k.startsWith('__'))
    );

    if (realSamples.length === 0) continue;

    // HELP
    lines.push(`# HELP ${metric.name} ${metric.help}`);
    lines.push(`# TYPE ${metric.name} ${metric.type}`);

    for (const sample of realSamples) {
      const labelStr = formatLabels(sample.labels);
      lines.push(`${metric.name}${labelStr} ${sample.value}`);
    }

    lines.push('');
  }

  return lines.join('\n');
}

// ============================================================
// Middleware for Next.js API routes
// ============================================================

import { NextRequest, NextResponse } from 'next/server';

export async function metricsMiddleware(
  request: NextRequest,
  handler: () => Promise<NextResponse>
): Promise<NextResponse> {
  const start = Date.now();

  try {
    const response = await handler();
    const durationSeconds = (Date.now() - start) / 1000;

    observeHttpRequestDuration(
      request.method,
      request.nextUrl.pathname,
      response.status,
      durationSeconds
    );
    countHttpRequest(request.method, request.nextUrl.pathname, response.status);

    return response;
  } catch (error) {
    const durationSeconds = (Date.now() - start) / 1000;

    observeHttpRequestDuration(
      request.method,
      request.nextUrl.pathname,
      500,
      durationSeconds
    );
    countHttpRequest(request.method, request.nextUrl.pathname, 500);
    countError('api', error instanceof Error ? error.constructor.name : 'unknown');

    throw error;
  }
}
