/**
 * Outbox Worker - reliable event publishing entrypoint.
 */

import { startOutboxWorker, getOutboxStats } from '@/services/reports/outbox-publisher';
import { emitDomainEvent } from '@/services/reports/domain-events';
import { logger } from '@/lib/logger';
import { recordWorkerHeartbeat } from '@/core/observability/health-tracker';
import { registerAllEventSchemas } from '@/core/event-bus/schema-registry';
import { getOutboxLeaderElection } from '@/core/infrastructure/leader-election';

async function main() {
  logger.info('Outbox worker starting');

  try {
    registerAllEventSchemas();
    logger.info('Event schemas registered');
  } catch (error) {
    logger.warn(
      'Failed to register event schemas - validation will be skipped',
      error instanceof Error ? { message: error.message } : undefined
    );
  }

  const election = getOutboxLeaderElection();
  let worker: ReturnType<typeof startOutboxWorker> | null = null;

  election.onBecomeLeader = () => {
    if (worker) return;

    logger.info('Outbox worker: became leader - starting processing');
    worker = startOutboxWorker(async (event) => emitDomainEvent(event), 10000);

    void recordWorkerHeartbeat('outbox').catch((error) => {
      logger.error(
        'Failed to record immediate heartbeat',
        error instanceof Error ? { message: error.message } : undefined
      );
    });
  };

  election.onLoseLeadership = () => {
    logger.info('Outbox worker: lost leadership - stopping processing');
    if (worker) {
      worker.stop();
      worker = null;
    }
  };

  await election.start();
  if (election.isLeader()) {
    await recordWorkerHeartbeat('outbox');
  }

  // Only emit INFO when stats are noteworthy (>0 backlog) or changed since
  // last tick; otherwise debug. Avoids the steady-state log flood (audit-
  // adjacent: same fix as in unified-worker/outbox.ts).
  let lastStatsSignature = '';
  const statsInterval = setInterval(async () => {
    try {
      const stats = await getOutboxStats();
      const signature = `${stats.unpublished}|${stats.failed}|${stats.total}`;
      const noteworthy = stats.unpublished > 0 || stats.failed > 0;
      const changed = signature !== lastStatsSignature;
      lastStatsSignature = signature;
      const payload = { ...stats, isLeader: election.isLeader() };
      if (noteworthy || changed) {
        logger.info('Outbox stats', payload);
      } else {
        logger.debug('Outbox stats (steady-state)', payload);
      }
    } catch (error) {
      logger.error(
        'Failed to get outbox stats',
        error instanceof Error ? { message: error.message } : undefined
      );
    }
  }, 60000);

  const heartbeatInterval = setInterval(async () => {
    if (!election.isLeader()) {
      return;
    }

    try {
      await recordWorkerHeartbeat('outbox');
    } catch (error) {
      logger.error(
        'Failed to record heartbeat',
        error instanceof Error ? { message: error.message } : undefined
      );
    }
  }, 30000);

  logger.info('Outbox worker started', {
    nodeId: election.getStats().nodeId,
    isLeader: election.isLeader(),
  });

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
