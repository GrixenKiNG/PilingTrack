/**
 * Projection Worker — Entry Point
 *
 * Processes unpublished outbox events and updates CQRS read projections.
 * Uses the modular projection worker from modules/reports.
 *
 * Leader Election: Only ONE instance processes events at a time.
 * Standby instances do nothing and wait for the leader to die.
 *
 * Usage:
 *   npx tsx src/workers/projection-worker.ts
 */

import { startProjectionWorker } from '@/modules/reports/application/projections/projection-worker';
import { registerAllEventHandlers } from '@/services/reports/event-handlers';
import { logger } from '@/lib/logger';
import { recordWorkerHeartbeat } from '@/core/observability/health-tracker';
import { getProjectionLeaderElection } from '@/core/infrastructure/leader-election';

async function main() {
  logger.info('Projection worker starting');

  // Register legacy event handlers for backward compatibility
  registerAllEventHandlers();

  // Leader Election — only one active worker
  const election = getProjectionLeaderElection();

  await election.start();

  // Worker instance — started/stopped based on leadership
  let worker: ReturnType<typeof startProjectionWorker> | null = null;

  election.onBecomeLeader = () => {
    logger.info('Projection worker: became leader — starting processing');
    worker = startProjectionWorker(5000);
  };

  election.onLoseLeadership = () => {
    logger.info('Projection worker: lost leadership — stopping processing');
    if (worker) {
      worker.stop();
      worker = null;
    }
  };

  // Record heartbeat every 30 seconds
  const heartbeatInterval = setInterval(async () => {
    try {
      await recordWorkerHeartbeat('projection');
    } catch (error) {
      logger.error('Failed to record heartbeat', error instanceof Error ? { message: error.message } : undefined);
    }
  }, 30000);

  logger.info('Projection worker started', {
    nodeId: election.getStats().nodeId,
    isLeader: election.isLeader(),
  });

  // Graceful shutdown
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
