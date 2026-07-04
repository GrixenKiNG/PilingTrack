/**
 * Event Loop Lag — real measurement via Node's perf_hooks histogram.
 *
 * /api/metrics used to report `performance.now() / 1000` as
 * "nodejs_eventloop_lag_seconds" — that's just current uptime in seconds,
 * not a lag measurement at all (monitoring module review, 2026-07-04).
 * `monitorEventLoopDelay` samples the actual delay between a scheduled
 * timer tick and when it fires, which is the real definition of event
 * loop lag.
 *
 * Singleton, enabled once at module load — same pattern as the redis
 * client / circuit breaker singletons elsewhere in core/.
 */
import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';

let histogram: IntervalHistogram | null = null;

function getHistogram(): IntervalHistogram {
  if (!histogram) {
    histogram = monitorEventLoopDelay({ resolution: 20 });
    histogram.enable();
  }
  return histogram;
}

// Module load enables sampling immediately, so the first scrape already
// has data instead of reporting a zero/NaN cold value.
getHistogram();

/** Mean event loop delay in seconds since the last reset (or process start). */
export function getEventLoopLagSeconds(): number {
  const mean = getHistogram().mean;
  // NaN before any samples have been recorded (freshly enabled/reset).
  return Number.isFinite(mean) ? mean / 1e9 : 0;
}

/**
 * Reset the histogram's accumulated stats. Call periodically (e.g. after
 * each scrape) so `mean` reflects recent behavior rather than an
 * all-time average that flattens out after days of uptime.
 */
export function resetEventLoopLag(): void {
  getHistogram().reset();
}
