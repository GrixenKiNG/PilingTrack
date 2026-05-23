import { getOutboxLeaderElection } from '@/core/infrastructure/leader-election';
import { logger } from '@/lib/logger';
import { emitDomainEvent } from '@/services/reports/domain-events';
import { registerAllEventSchemas } from '@/core/event-bus/schema-registry';
import { registerAllEventHandlers } from '@/services/reports/event-handlers';
import { getOutboxStats, startOutboxWorker } from '@/services/reports/outbox-publisher';
import { OUTBOX_INTERVAL } from './config';
import { recordLeaderHeartbeat, setRunning, workerStates } from './state';

export async function startOutbox(): Promise<void> {
  const state = workerStates.outbox;
  const election = getOutboxLeaderElection();
  let worker: ReturnType<typeof startOutboxWorker> | null = null;

  logger.info('Arming outbox worker', { intervalMs: OUTBOX_INTERVAL });

  try {
    registerAllEventSchemas();
  } catch (error) {
    logger.warn('Failed to register event schemas', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Register in-process subscribers BEFORE the outbox loop starts emitting.
  // The outbox callback calls emitDomainEvent(); without handlers registered
  // here, the very first events go into a void — ReportAnalytics never gets
  // written and the failure is silent (emitDomainEvent only logs at debug
  // level when LOG_UNHANDLED_EVENTS=true). startProjection registers the
  // same handlers, but races with this loop on startup; this duplicate call
  // is idempotent (registerAllEventHandlers internally guards re-entry).
  try {
    registerAllEventHandlers();
  } catch (error) {
    logger.warn('Failed to register event handlers in outbox loop', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  election.onBecomeLeader = () => {
    if (worker) return;

    state.isLeader = true;
    setRunning(state);
    logger.info('Outbox worker became leader');

    worker = startOutboxWorker(async (event) => {
      await emitDomainEvent(event);
      await recordLeaderHeartbeat('outbox', election);
    }, OUTBOX_INTERVAL);

    void recordLeaderHeartbeat('outbox', election).catch((error) => {
      logger.error('Outbox worker immediate heartbeat failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };

  election.onLoseLeadership = () => {
    logger.info('Outbox worker lost leadership');
    state.isLeader = false;

    if (worker) {
      worker.stop();
      worker = null;
    }
  };

  await election.start();
  setRunning(state);
  state.isLeader = election.isLeader();
  await recordLeaderHeartbeat('outbox', election);

  const heartbeatInterval = setInterval(() => {
    void recordLeaderHeartbeat('outbox', election).catch((error) => {
      logger.error('Outbox worker heartbeat failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, 30_000);

  // Heartbeat-style stats log was firing INFO every minute even when nothing
  // changed (305 events, 0 unpublished, 0 failed — same line forever). Keep
  // the periodic check, but only emit INFO when there's something worth
  // operator attention; otherwise demote to debug.
  let lastStatsSignature = '';
  const statsInterval = setInterval(() => {
    if (!election.isLeader()) return;

    void getOutboxStats()
      .then((stats) => {
        const signature = `${stats.unpublished}|${stats.failed}|${stats.total}`;
        const noteworthy = stats.unpublished > 0 || stats.failed > 0;
        const changed = signature !== lastStatsSignature;
        lastStatsSignature = signature;
        if (noteworthy || changed) {
          logger.info('Outbox stats', stats);
        } else {
          logger.debug('Outbox stats (steady-state)', stats);
        }
      })
      .catch((error) => {
        logger.error('Failed to get outbox stats', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }, 60_000);

  state.stop = async () => {
    clearInterval(heartbeatInterval);
    clearInterval(statsInterval);
    if (worker) {
      worker.stop();
      worker = null;
    }
    state.isLeader = false;
    state.status = 'stopped';
    await election.stop();
  };
}
