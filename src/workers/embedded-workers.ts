/**
 * Embedded background workers for the Next.js server process.
 *
 * In production we start critical background workers inside the app process
 * by default so health checks do not report "workers: stopped" when a
 * separate worker service is not deployed.
 */

import { emitDomainEvent } from '@/services/reports/domain-events';
import { registerAllEventHandlers } from '@/services/reports/event-handlers';
import { registerAllEventSchemas } from '@/core/event-bus/schema-registry';
import {
  getOutboxLeaderElection,
  getProjectionLeaderElection,
  LeaderElection,
} from '@/core/infrastructure/leader-election';
import { logger } from '@/lib/logger';

type EmbeddedWorkerName = 'outbox' | 'projection';

interface EmbeddedWorkerHandle {
  stop: () => Promise<void>;
}

const DEFAULT_WORKERS: EmbeddedWorkerName[] = ['outbox', 'projection'];
const HEARTBEAT_INTERVAL_MS = 30_000;
const OUTBOX_STATS_INTERVAL_MS = 60_000;

function shouldLogWorkerLifecycle(): boolean {
  return process.env.LOG_WORKER_LIFECYCLE === 'true';
}

let startupPromise: Promise<void> | null = null;
let shutdownRegistered = false;
const activeHandles: EmbeddedWorkerHandle[] = [];

async function recordEmbeddedWorkerHeartbeat(workerName: EmbeddedWorkerName): Promise<void> {
  const { recordWorkerHeartbeat } = await import('@/core/observability/health-tracker');
  await recordWorkerHeartbeat(workerName);
}

function parseEnabledWorkers(): EmbeddedWorkerName[] {
  const raw = process.env.EMBEDDED_WORKERS?.trim();

  if (!raw) {
    return process.env.NODE_ENV === 'test' ? [] : DEFAULT_WORKERS;
  }

  const normalized = raw.toLowerCase();
  if (['0', 'false', 'off', 'none', 'disabled'].includes(normalized)) {
    return [];
  }

  if (['1', 'true', 'on', 'default'].includes(normalized)) {
    return DEFAULT_WORKERS;
  }

  const allowed = new Set<EmbeddedWorkerName>(DEFAULT_WORKERS);
  return raw
    .split(',')
    .map((name) => name.trim().toLowerCase() as EmbeddedWorkerName)
    .filter((name): name is EmbeddedWorkerName => allowed.has(name));
}

async function recordLeaderHeartbeat(
  workerName: EmbeddedWorkerName,
  election: LeaderElection
): Promise<void> {
  if (!election.isLeader()) {
    return;
  }

  await recordEmbeddedWorkerHeartbeat(workerName);
}

function registerShutdownHook() {
  if (shutdownRegistered || typeof process === 'undefined') {
    return;
  }

  shutdownRegistered = true;

  const shutdown = async (signal: string) => {
    if (shouldLogWorkerLifecycle()) {
      logger.info('Embedded workers shutting down', { signal });
    }

    const handles = activeHandles.splice(0, activeHandles.length);
    await Promise.all(
      handles.map((handle) =>
        handle.stop().catch((error) => {
          logger.error('Embedded worker shutdown failed', {
            signal,
            error: error instanceof Error ? error.message : String(error),
          });
        })
      )
    );
  };

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
}

async function startEmbeddedOutboxWorker(): Promise<EmbeddedWorkerHandle> {
  const { getOutboxStats, startOutboxWorker } = await import('@/services/reports/outbox-publisher');

  try {
    registerAllEventSchemas();
  } catch (error) {
    logger.warn('Embedded outbox: failed to register schemas', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const election = getOutboxLeaderElection();
  let worker: ReturnType<typeof startOutboxWorker> | null = null;

  election.onBecomeLeader = () => {
    if (worker) {
      return;
    }

    if (shouldLogWorkerLifecycle()) {
      logger.info('Embedded outbox: became leader');
    }
    worker = startOutboxWorker(async (event) => emitDomainEvent(event), 10_000);

    void recordLeaderHeartbeat('outbox', election).catch((error) => {
      logger.error('Embedded outbox: immediate heartbeat failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };

  election.onLoseLeadership = () => {
    if (shouldLogWorkerLifecycle()) {
      logger.info('Embedded outbox: lost leadership');
    }

    if (worker) {
      worker.stop();
      worker = null;
    }
  };

  await election.start();
  await recordLeaderHeartbeat('outbox', election);

  const heartbeatInterval = setInterval(() => {
    void recordLeaderHeartbeat('outbox', election).catch((error) => {
      logger.error('Embedded outbox: heartbeat failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, HEARTBEAT_INTERVAL_MS);

  const statsInterval = setInterval(() => {
    if (!election.isLeader()) {
      return;
    }

    void getOutboxStats()
      .then((stats) => {
        if (stats.failed > 0) {
          logger.error('Embedded outbox stats', undefined, stats);
          return;
        }

        if (stats.unpublished > 0) {
          logger.warn('Embedded outbox stats', stats);
          return;
        }

        if (process.env.LOG_WORKER_STATS === 'true') {
          logger.info('Embedded outbox stats', stats);
        }
      })
      .catch((error) => {
        logger.error('Embedded outbox: stats failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }, OUTBOX_STATS_INTERVAL_MS);

  if (shouldLogWorkerLifecycle()) {
    logger.info('Embedded outbox worker armed', {
      isLeader: election.isLeader(),
      nodeId: election.getStats().nodeId,
    });
  }

  return {
    stop: async () => {
      clearInterval(heartbeatInterval);
      clearInterval(statsInterval);
      if (worker) {
        worker.stop();
        worker = null;
      }
      await election.stop();
    },
  };
}

async function startEmbeddedProjectionWorker(): Promise<EmbeddedWorkerHandle> {
  const { startProjectionWorker } = await import(
    '@/modules/reports/application/projections/projection-worker'
  );

  try {
    registerAllEventHandlers();
  } catch (error) {
    logger.warn('Embedded projection: failed to register handlers', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const election = getProjectionLeaderElection();
  let worker: ReturnType<typeof startProjectionWorker> | null = null;

  election.onBecomeLeader = () => {
    if (worker) {
      return;
    }

    if (shouldLogWorkerLifecycle()) {
      logger.info('Embedded projection: became leader');
    }
    worker = startProjectionWorker(5_000);

    void recordLeaderHeartbeat('projection', election).catch((error) => {
      logger.error('Embedded projection: immediate heartbeat failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };

  election.onLoseLeadership = () => {
    if (shouldLogWorkerLifecycle()) {
      logger.info('Embedded projection: lost leadership');
    }

    if (worker) {
      worker.stop();
      worker = null;
    }
  };

  await election.start();
  await recordLeaderHeartbeat('projection', election);

  const heartbeatInterval = setInterval(() => {
    void recordLeaderHeartbeat('projection', election).catch((error) => {
      logger.error('Embedded projection: heartbeat failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, HEARTBEAT_INTERVAL_MS);

  if (shouldLogWorkerLifecycle()) {
    logger.info('Embedded projection worker armed', {
      isLeader: election.isLeader(),
      nodeId: election.getStats().nodeId,
    });
  }

  return {
    stop: async () => {
      clearInterval(heartbeatInterval);
      if (worker) {
        worker.stop();
        worker = null;
      }
      await election.stop();
    },
  };
}

export async function startEmbeddedWorkers(): Promise<void> {
  if (startupPromise) {
    return startupPromise;
  }

  startupPromise = (async () => {
    const enabledWorkers = parseEnabledWorkers();

    if (enabledWorkers.length === 0) {
      if (shouldLogWorkerLifecycle()) {
        logger.info('Embedded workers disabled');
      }
      return;
    }

    registerShutdownHook();

    if (shouldLogWorkerLifecycle()) {
      logger.info('Starting embedded workers', { enabledWorkers });
    }

    if (enabledWorkers.includes('outbox')) {
      activeHandles.push(await startEmbeddedOutboxWorker());
    }

    if (enabledWorkers.includes('projection')) {
      activeHandles.push(await startEmbeddedProjectionWorker());
    }
  })();

  return startupPromise;
}
