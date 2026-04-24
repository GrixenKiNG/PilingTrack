/**
 * Projection Worker - CQRS projection entrypoint.
 */

import { startProjectionWorker } from '@/modules/reports/application/projections/projection-worker';
import { registerAllEventHandlers } from '@/services/reports/event-handlers';
import { logger } from '@/lib/logger';
import { recordWorkerHeartbeat } from '@/core/observability/health-tracker';
import { getProjectionLeaderElection } from '@/core/infrastructure/leader-election';

async function main() {
  logger.info('Projection worker starting');

  registerAllEventHandlers();

  const election = getProjectionLeaderElection();
  let worker: ReturnType<typeof startProjectionWorker> | null = null;

  election.onBecomeLeader = () => {
    if (worker) return;

    logger.info('Projection worker: became leader - starting processing');
    worker = startProjectionWorker(5000);

    void recordWorkerHeartbeat('projection').catch((error) => {
      logger.error(
        'Failed to record immediate heartbeat',
        error instanceof Error ? { message: error.message } : undefined
      );
    });
  };

  election.onLoseLeadership = () => {
    logger.info('Projection worker: lost leadership - stopping processing');
    if (worker) {
      worker.stop();
      worker = null;
    }
  };

  await election.start();
  if (election.isLeader()) {
    await recordWorkerHeartbeat('projection');
  }

  const heartbeatInterval = setInterval(async () => {
    if (!election.isLeader()) {
      return;
    }

    try {
      await recordWorkerHeartbeat('projection');
    } catch (error) {
      logger.error(
        'Failed to record heartbeat',
        error instanceof Error ? { message: error.message } : undefined
      );
    }
  }, 30000);

  logger.info('Projection worker started', {
    nodeId: election.getStats().nodeId,
    isLeader: election.isLeader(),
  });

  process.on('SIGTERM', async () => {
    logger.info('Projection worker shutting down');
    clearInterval(heartbeatInterval);
    if (worker) worker.stop();
    await election.stop();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    logger.info('Projection worker interrupted');
    clearInterval(heartbeatInterval);
    if (worker) worker.stop();
    await election.stop();
    process.exit(0);
  });
}

main().catch((error) => {
  logger.error('Projection worker crashed', error);
  process.exit(1);
});
