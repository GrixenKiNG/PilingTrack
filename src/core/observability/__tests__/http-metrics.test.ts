/**
 * http-metrics — Counter + latency Histogram for HTTP requests.
 *
 * alerts.yml references http_request_duration_seconds_bucket and
 * http_requests_total in three alert rules (HighAPILatencyP95,
 * HighAPILatencyP99, HighAPIErrorRate), but nothing in the app ever
 * created these metrics (monitoring module review, 2026-07-04) — the
 * alerts had no data source and could never fire.
 *
 * `route` must stay low-cardinality (a route template/domain, e.g.
 * 'media.confirm' — the same value already passed as `domain` to
 * withApi/withMutation), never the resolved URL with real IDs, or the
 * label set grows unbounded as new entity IDs appear.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { recordHttpRequest, exportHttpMetricsPrometheus, resetHttpMetrics } from '../http-metrics';

describe('http-metrics', () => {
  beforeEach(() => {
    resetHttpMetrics();
  });

  it('records a request and exports counter + histogram lines', () => {
    recordHttpRequest('GET', 'reports', 200, 0.05);
    const out = exportHttpMetricsPrometheus();

    expect(out).toContain('# TYPE http_requests_total counter');
    expect(out).toContain('http_requests_total{method="GET",route="reports",status="200"} 1');
    expect(out).toContain('# TYPE http_request_duration_seconds histogram');
    expect(out).toContain('http_request_duration_seconds_sum{method="GET",route="reports",status="200"} 0.05');
    expect(out).toContain('http_request_duration_seconds_count{method="GET",route="reports",status="200"} 1');
  });

  it('accumulates cumulative bucket counts correctly (a fast + a slow request)', () => {
    recordHttpRequest('GET', 'reports', 200, 0.01); // falls in every bucket >= 0.01
    recordHttpRequest('GET', 'reports', 200, 2); // only falls in buckets >= 2

    const out = exportHttpMetricsPrometheus();
    // le=0.01 bucket only counts the fast request.
    expect(out).toContain('http_request_duration_seconds_bucket{method="GET",route="reports",status="200",le="0.01"} 1');
    // le=5 bucket (or higher, below +Inf) counts both.
    expect(out).toMatch(/http_request_duration_seconds_bucket\{method="GET",route="reports",status="200",le="5"\} 2/);
    // +Inf always equals the total count for that series.
    expect(out).toContain('http_request_duration_seconds_bucket{method="GET",route="reports",status="200",le="+Inf"} 2');
    expect(out).toContain('http_request_duration_seconds_count{method="GET",route="reports",status="200"} 2');
  });

  it('keeps separate series per (method, route, status) combination', () => {
    recordHttpRequest('GET', 'reports', 200, 0.1);
    recordHttpRequest('POST', 'reports', 201, 0.1);
    recordHttpRequest('GET', 'media.confirm', 422, 0.1);

    const out = exportHttpMetricsPrometheus();
    expect(out).toContain('http_requests_total{method="GET",route="reports",status="200"} 1');
    expect(out).toContain('http_requests_total{method="POST",route="reports",status="201"} 1');
    expect(out).toContain('http_requests_total{method="GET",route="media.confirm",status="422"} 1');
  });

  it('bounded cardinality: repeated requests to the same series increment counts, not new lines', () => {
    for (let i = 0; i < 50; i++) recordHttpRequest('GET', 'reports', 200, 0.05);
    const out = exportHttpMetricsPrometheus();
    const matches = out.match(/http_requests_total\{method="GET",route="reports",status="200"\}/g);
    expect(matches).toHaveLength(1);
    expect(out).toContain('http_requests_total{method="GET",route="reports",status="200"} 50');
  });

  it('resetHttpMetrics clears all recorded series', () => {
    recordHttpRequest('GET', 'reports', 200, 0.05);
    resetHttpMetrics();
    const out = exportHttpMetricsPrometheus();
    expect(out).not.toContain('route="reports"');
  });

  it('returns valid (parseable) output with no recorded requests', () => {
    const out = exportHttpMetricsPrometheus();
    expect(out).toContain('# HELP http_requests_total');
    expect(out).not.toContain('undefined');
    expect(out).not.toContain('NaN');
  });
});
