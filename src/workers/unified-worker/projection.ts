import { getProjectionLeaderElection } from '@/core/infrastructure/leader-election';
import { startProjectionWorker } from '@/modules/reports/application/projections/projection-worker';
import { registerAllEventHandlers } from '@/services/reports/event-handlers';
import { logger } from '@/lib/logger';
import { PROJECTION_INTERVAL } from './config';
import { recordLeaderHeartbeat, setRunning, workerStates } from './state';

export async function startProjection(): Promise<void> {
  const state = workerStates.projection;
  const election = getProjectionLeaderElection();
  let worker: ReturnType<typeof startProjectionWorker> | null = null;

  logger.info('Arming projection worker', { intervalMs: PROJECTION_INTERVAL });

  try {
    registerAllEventHandlers();
  } catch (error) {
    logger.warn('Failed to register event handlers', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  election.onBecomeLeader = () => {
    if (worker) return;

    state.isLeader = true;
    setRunning(state);
    logger.info('Projection worker became leader');

    worker = startProjectionWorker(PROJECTION_INTERVAL);

    void recordLeaderHeartbeat('projection', election).catch((error) => {
      logger.error('Projection worker immediate heartbeat failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };

  election.onLoseLeadership = () => {
    logger.info('Projection worker lost leadership');
    state.isLeader = false;

    if (worker) {
      worker.stop();
      worker = null;
    }
  };

  await election.start();
  setRunning(state);
  state.isLeader = election.isLeader();
  await recordLeaderHeartbeat('projection', election);

  const heartbeatInterval = setInterval(() => {
    void recordLeaderHeartbeat('projection', election).catch((error) => {
      logger.error('Projection worker heartbeat failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, 30_000);

  state.stop = async () => {
    clearInterval(heartbeatInterval);
    if (worker) {
      worker.stop();
      worker = null;
    }
    state.isLeader = false;
    state.status = 'stopped';
    await election.stop();
  };
}
