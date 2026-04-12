/**
 * Outbox Worker — Background process for reliable event publishing
 *
 * Polls unpublished events from outbox table and publishes them
 * to the event bus. Handles retries with exponential backoff.
 *
 * Leader Election: Only ONE instance processes events at a time.
 * Standby instances do nothing and wait for the leader to die.
 *
 * Usage:
 *   npx tsx src/workers/outbox-worker.ts
 *
 * Or as a systemd service / Docker container in production.
 */

import { startOutboxWorker, getOutboxStats } from '@/services/reports/outbox-publisher';
import { emitDomainEvent } from '@/services/reports/domain-events';
import { logger } from '@/lib/logger';
import { recordWorkerHeartbeat } from '@/core/observability/health-tracker';
import { registerAllEventSchemas } from '@/core/event-bus/schema-registry';
import { getOutboxLeaderElection } from '@/core/infrastructure/leader-election';

async function main() {
  logger.info('Outbox worker starting');

  // Register all event schemas for validation
  try {
    registerAllEventSchemas();
    logger.info('Event schemas registered');
  } catch (error) {
    logger.warn('Failed to register event schemas — validation will be skipped', error instanceof Error ? { message: error.message } : undefined);
  }

  // Leader Election — only one active worker
  const election = getOutboxLeaderElection();

  await election.start();

  // Worker instance — started/stopped based on leadership
  let worker: ReturnType<typeof startOutboxWorker> | null = null;

  election.onBecomeLeader = () => {
    logger.info('Outbox worker: became leader — starting processing');
    worker = startOutboxWorker(async (event) => emitDomainEvent(event), 10000);
  };

  election.onLoseLeadership = () => {
    logger.info('Outbox worker: lost leadership — stopping processing');
    if (worker) {
      worker.stop();
      worker = null;
    }
  };

  // Log stats every 60 seconds (even for standby)
  const statsInterval = setInterval(async () => {
    try {
      const stats = await getOutboxStats();
      logger.info('Outbox stats', {
        ...stats,
        isLeader: election.isLeader(),
      });
    } catch (error) {
      logger.error('Failed to get outbox stats', error instanceof Error ? { message: error.message } : undefined);
    }
  }, 60000);

  // Record heartbeat every 30 seconds
  const heartbeatInterval = setInterval(async () => {
    try {
      await recordWorkerHeartbeat('outbox');
    } catch (error) {
      logger.error('Failed to record heartbeat', error instanceof Error ? { message: error.message } : undefined);
    }
  }, 30000);

  logger.info('Outbox worker started', {
    nodeId: election.getStats().nodeId,
    isLeader: election.isLeader(),
  });

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    logger.info('Outbox worker shutting down');
    clearInterval(statsInterval);
    clearInterval(heartbeatInterval);
    if (worker) worker.stop();
    await election.stop();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    logger.info('Outbox worker interrupted');
    clearInterval(statsInterval);
    clearInterval(heartbeatInterval);
    if (worker) worker.stop();
    await election.stop();
    process.exit(0);
  });
}

main().catch((error) => {
  logger.error('Outbox worker crashed', error);
  process.exit(1);
});
