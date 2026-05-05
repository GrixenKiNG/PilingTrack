import { logger } from '../logger';
import { LagAlert, startLagMonitor } from '../lag-monitor';
import { checkSystemStatus } from './aggregate';
import { POLL_INTERVAL_MS } from './thresholds';
import type { SystemStatus } from './types';

let cachedStatus: SystemStatus | null = null;
let trackerStarted = false;

function shouldLogHealthTrackerLifecycle(): boolean {
  return process.env.LOG_WORKER_LIFECYCLE === 'true';
}

function startBackgroundTracker(): void {
  if (trackerStarted) return;
  trackerStarted = true;

  startLagMonitor({
    onAlert: (alert: LagAlert) => {
      logger[alert.level === 'critical' ? 'error' : 'warn'](`🚨 ${alert.message}`, {
        metric: alert.metric,
        value: alert.value,
        threshold: alert.threshold,
      });
    },
  });

  async function tick() {
    try {
      const status = await checkSystemStatus();
      cachedStatus = status;

      if (status.status !== 'healthy') {
        logger.warn('System health check', {
          status: status.status,
          database: status.components.database.status,
          redis: status.components.redis.status,
          outbox: status.components.outbox.status,
          workers: status.components.workers.status,
        });
      }
    } catch (err) {
      logger.error('Health tracker tick failed', err);
    }

    setTimeout(tick, POLL_INTERVAL_MS);
  }

  tick();

  if (shouldLogHealthTrackerLifecycle()) {
    logger.info('Health tracker started', { intervalMs: POLL_INTERVAL_MS });
  }
}

/**
 * Get the most recent health status.
 * Returns cached result (updated every 15s) for fast response.
 */
export function getCurrentStatus(): SystemStatus | null {
  return cachedStatus;
}

/**
 * Start the background health tracker.
 * Call once at application startup.
 */
export function startHealthTracker(): void {
  startBackgroundTracker();
}

/**
 * Force an immediate fresh check (bypasses cache).
 * Use sparingly — this hits all subsystems.
 */
export async function getFreshStatus(): Promise<SystemStatus> {
  const status = await checkSystemStatus();
  cachedStatus = status;
  return status;
}
