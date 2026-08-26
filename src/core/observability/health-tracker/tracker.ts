import { logger } from '../logger';
import { LagAlert, startLagMonitor } from '../lag-monitor';
import { checkSystemStatus } from './aggregate';
import { POLL_INTERVAL_MS } from './thresholds';
import type { SystemStatus } from './types';

let cachedStatus: SystemStatus | null = null;
let trackerStarted = false;

/** Как часто повторять запись о неизменившейся поломке. */
export const HEALTH_LOG_REMINDER_MS = 60 * 60 * 1000;

let lastUnhealthySignature: string | null = null;
let lastUnhealthyLoggedAt = 0;

function shouldLogHealthTrackerLifecycle(): boolean {
  return process.env.LOG_WORKER_LIFECYCLE === 'true';
}

/**
 * Опрос идёт каждые 15 секунд, но писать столько же незачем: одна и та же
 * строка 240 раз в час тонет в собственном повторе. Пишем смену картины —
 * и раз в час напоминаем, что поломка ещё жива (иначе система, лежащая
 * сутки, оставит одну строку в самом начале).
 */
export function shouldLogHealthSnapshot(
  signature: string,
  previousSignature: string | null,
  msSinceLastLog: number,
): boolean {
  if (signature !== previousSignature) return true;
  return msSinceLastLog >= HEALTH_LOG_REMINDER_MS;
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

      if (status.status === 'healthy') {
        // Сброс обязателен: без него связка «сломалось → починилось → сломалось
        // так же» читается как «та же картина» и второй раз в лог не попадёт
        // до конца часа — регрессия останется незамеченной.
        if (lastUnhealthySignature !== null) {
          logger.info('System health recovered');
          lastUnhealthySignature = null;
          lastUnhealthyLoggedAt = 0;
        }
      } else {
        // Все семь компонентов, а не четыре: вердикт считает по ним же
        // (`computeOverallStatus`), и запись, где половина слагаемых опущена,
        // читается как противоречие — «unhealthy» при четырёх зелёных.
        const snapshot = {
          status: status.status,
          database: status.components.database.status,
          redis: status.components.redis.status,
          outbox: status.components.outbox.status,
          workers: status.components.workers.status,
          storage: status.components.storage.status,
          websocket: status.components.websocket.status,
          backup: status.components.backup.status,
        };
        const signature = Object.values(snapshot).join('|');
        const now = Date.now();

        if (shouldLogHealthSnapshot(signature, lastUnhealthySignature, now - lastUnhealthyLoggedAt)) {
          logger.warn('System health check', snapshot);
          lastUnhealthySignature = signature;
          lastUnhealthyLoggedAt = now;
        }
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
