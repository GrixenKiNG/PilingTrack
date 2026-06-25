/**
 * Unified worker service standalone runtime.
 *
 * Runs background workers in a dedicated process: outbox, projection, PDF.
 * Outbox and projection are leader-elected so a dedicated worker process can
 * coexist with embedded workers running inside the app server.
 *
 * Internal split under ./unified-worker/:
 *   config.ts         — env-based configuration + WorkerName/WorkerStatus types
 *   state.ts          — shared workerStates + heartbeat helpers
 *   health-server.ts  — HTTP /health + /metrics
 *   outbox.ts         — outbox worker startup + leader election wiring
 *   projection.ts     — projection worker startup + leader election wiring
 *   pdf.ts            — BullMQ PDF generation worker
 */

import 'dotenv/config';
import http from 'http';
import { logger } from '@/lib/logger';
import { ENABLED_WORKERS, HEALTH_PORT } from './unified-worker/config';
import { startHealthServer } from './unified-worker/health-server';
import { startOutbox } from './unified-worker/outbox';
import { startPdf } from './unified-worker/pdf';
import { startProjection } from './unified-worker/projection';
import { startPmScheduler } from './unified-worker/pm-scheduler';
import { workerStates } from './unified-worker/state';

let isShuttingDown = false;
let healthServer: http.Server | null = null;
let stopPmScheduler: (() => void) | null = null;

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    logger.warn('Shutdown already in progress', { signal });
    process.exit(1);
  }

  isShuttingDown = true;
  logger.info('Received shutdown signal', { signal });

  const stops = Object.values(workerStates)
    .filter((worker) => worker.stop && worker.status !== 'stopped')
    .map(async (worker) => {
      try {
        logger.info('Stopping worker', { worker: worker.name });
        await worker.stop?.();
      } catch (error) {
        logger.error('Worker shutdown failed', {
          worker: worker.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

  await Promise.all(stops);

  if (stopPmScheduler) {
    stopPmScheduler();
    stopPmScheduler = null;
  }

  if (healthServer) {
    await new Promise<void>((resolve) => {
      healthServer?.close(() => resolve());
    });
  }

  logger.info('Unified worker shutdown complete');
  process.exit(0);
}

async function main(): Promise<void> {
  logger.info('Unified Worker Service starting', {
    enabledWorkers: ENABLED_WORKERS,
    healthPort: HEALTH_PORT,
  });

  healthServer = startHealthServer();

  const startups: Promise<void>[] = [];

  if (ENABLED_WORKERS.includes('outbox')) {
    startups.push(startOutbox());
  } else {
    workerStates.outbox.status = 'stopped';
  }

  if (ENABLED_WORKERS.includes('projection')) {
    startups.push(startProjection());
  } else {
    workerStates.projection.status = 'stopped';
  }

  if (ENABLED_WORKERS.includes('pdf')) {
    startups.push(startPdf());
  } else {
    workerStates.pdf.status = 'stopped';
  }

  await Promise.all(startups);

  // PM scheduler tick — idempotent daily job, no leader election needed.
  if (process.env.PM_SCHEDULER_ENABLED !== 'false') {
    stopPmScheduler = startPmScheduler();
  }

  logger.info('Unified Worker Service ready');

  process.on('SIGTERM', () => {
    void gracefulShutdown('SIGTERM');
  });

  process.on('SIGINT', () => {
    void gracefulShutdown('SIGINT');
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception in unified worker', {
      error: error.message,
    });
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection in unified worker', {
      reason: reason instanceof Error ? reason.message : String(reason),
    });
  });
}

main().catch((error) => {
  logger.error('Unified worker service failed to start', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
