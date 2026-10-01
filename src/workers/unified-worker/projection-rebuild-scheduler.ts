/**
 * Projection rebuild safety-net.
 *
 * The analytics read-models (ReportAnalytics / SiteDailySummary /
 * SiteWeeklyTrend) are rebuild-style projections: historical events stay
 * `projected=true`, so the live worker does not replay them. After a DB restore
 * from a dump — or if the projection worker ever lags/restarts — these tables
 * silently go stale with no auto-heal (the analytics screen shows empty/zeros
 * while reports keep flowing). See project_analytics_rebuild_gap.
 *
 * This runs `rebuildAll()` shortly after startup (covers the dump-restore case)
 * and once a day after that. `rebuildAll` is a full recompute from the Report
 * source of truth — idempotent, so no leader election is needed.
 */

import * as Sentry from '@sentry/nextjs';
import { logger } from '@/lib/logger';
import { rebuildAll } from '@/modules/reports/application/projections/rebuild';
import { recordSchedulerHeartbeat } from './scheduler-heartbeat';
import { positiveIntEnv } from './env-int';

const REBUILD_INTERVAL = positiveIntEnv('PROJECTION_REBUILD_INTERVAL_MS', 24 * 60 * 60 * 1000);
const REBUILD_STARTUP_DELAY = positiveIntEnv('PROJECTION_REBUILD_STARTUP_DELAY_MS', 90000);

async function runOnce(): Promise<void> {
  try {
    const results = await rebuildAll();
    const rows = results.reduce((sum, r) => sum + r.rowsWritten, 0);
    logger.info('Projection rebuild pass', { rows, projections: results.length });
    await recordSchedulerHeartbeat('projection-rebuild', REBUILD_INTERVAL);
  } catch (error) {
    logger.error('Projection rebuild pass failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    Sentry.captureException(error, { tags: { task: 'projection-rebuild' } });
  }
}

/** Start the daily rebuild safety-net. Returns a stop fn that clears the timers. */
export function startProjectionRebuildScheduler(): () => void {
  logger.info('Arming projection rebuild scheduler', { intervalMs: REBUILD_INTERVAL });
  const startupTimer = setTimeout(() => void runOnce(), REBUILD_STARTUP_DELAY);
  const interval = setInterval(() => void runOnce(), REBUILD_INTERVAL);
  return () => {
    clearTimeout(startupTimer);
    clearInterval(interval);
  };
}
