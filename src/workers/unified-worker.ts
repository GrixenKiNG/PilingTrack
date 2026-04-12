/**
 * Unified Worker Service — Standalone Runtime
 *
 * Runs all background workers as a separate process from the Next.js app:
 * - Outbox Worker: publishes domain events from transactional outbox
 * - Projection Worker: updates CQRS read models from events
 * - PDF Worker: generates PDFs from BullMQ queue
 *
 * Architecture:
 * ┌─────────────────┐    ┌──────────────────┐    ┌─────────────┐
 * │  Next.js App    │    │  Worker Service  │    │  PDF Queue  │
 * │  (API + Web)    │───>│  (outbox +       │<──>│  (BullMQ +  │
 * │  port 3000      │    │   projections)   │    │   Redis)    │
 * └─────────────────┘    └──────────────────┘    └─────────────┘
 *
 * Health Check: HTTP server on WORKER_HEALTH_PORT (default 3002)
 *   GET /health → { status: "ok", workers: {...} }
 *
 * Usage:
 *   npx tsx src/workers/unified-worker.ts
 *   # or: npm run worker:all
 */

import http from 'http';
import { startOutboxWorker, getOutboxStats } from '@/services/reports/outbox-publisher';
import { emitDomainEvent } from '@/services/reports/domain-events';
import { startProjectionWorker } from '@/modules/reports/application/projections/projection-worker';
import { registerAllEventHandlers } from '@/services/reports/event-handlers';
import { registerAllEventSchemas } from '@/core/event-bus/schema-registry';
import { logger } from '@/lib/logger';
import { recordWorkerHeartbeat } from '@/core/observability/health-tracker';

// ============================================================
// Configuration
// ============================================================

const HEALTH_PORT = parseInt(process.env.WORKER_HEALTH_PORT || '3002', 10);
const OUTBOX_INTERVAL = parseInt(process.env.OUTBOX_INTERVAL_MS || '10000', 10);
const PROJECTION_INTERVAL = parseInt(process.env.PROJECTION_INTERVAL_MS || '5000', 10);
const ENABLED_WORKERS = (process.env.ENABLED_WORKERS || 'outbox,projection,pdf').split(',');

// ============================================================
// Worker State Tracking
// ============================================================

interface WorkerState {
  name: string;
  status: 'starting' | 'running' | 'error' | 'stopped';
  lastHeartbeat: Date | null;
  error: string | null;
  startedAt: Date | null;
  stop: (() => void) | null;
}

const workerStates: Record<string, WorkerState> = {
  outbox: {
    name: 'outbox',
    status: 'starting',
    lastHeartbeat: null,
    error: null,
    startedAt: null,
    stop: null,
  },
  projection: {
    name: 'projection',
    status: 'starting',
    lastHeartbeat: null,
    error: null,
    startedAt: null,
    stop: null,
  },
  pdf: {
    name: 'pdf',
    status: 'starting',
    lastHeartbeat: null,
    error: null,
    startedAt: null,
    stop: null,
  },
};

// ============================================================
// Health Check HTTP Server
// ============================================================

function startHealthServer(): http.Server {
  const server = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/api/health') {
      const allWorkers = Object.values(workerStates);
      const runningWorkers = allWorkers.filter((w) => w.status === 'running');
      const errorWorkers = allWorkers.filter((w) => w.status === 'error');

      const statusCode =
        errorWorkers.length > 0 ? 503 : runningWorkers.length > 0 ? 200 : 503;

      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          status: errorWorkers.length > 0 ? 'degraded' : 'ok',
          uptime: process.uptime(),
          pid: process.pid,
          memory: process.memoryUsage(),
          workers: Object.fromEntries(
            allWorkers.map((w) => [
              w.name,
              {
                status: w.status,
                lastHeartbeat: w.lastHeartbeat?.toISOString(),
                error: w.error,
                uptime: w.startedAt ? (Date.now() - w.startedAt.getTime()) / 1000 : 0,
              },
            ])
          ),
        })
      );
      return;
    }

    if (req.url === '/metrics') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      const lines: string[] = [];

      for (const [name, state] of Object.entries(workerStates)) {
        lines.push(
          `worker_status{name="${name}"} ${state.status === 'running' ? 1 : 0}`
        );
        lines.push(
          `worker_uptime_seconds{name="${name}"} ${
            state.startedAt ? (Date.now() - state.startedAt.getTime()) / 1000 : 0
          }`
        );
      }

      res.end(lines.join('\n') + '\n');
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  server.listen(HEALTH_PORT, () => {
    logger.info('Worker health server started', { port: HEALTH_PORT });
  });

  return server;
}

// ============================================================
// Worker Start/Stop Functions
// ============================================================

async function startOutbox(): Promise<void> {
  const state = workerStates.outbox;
  logger.info('Starting outbox worker');

  try {
    registerAllEventSchemas();
  } catch (error) {
    logger.warn('Failed to register event schemas', { error: error instanceof Error ? error.message : String(error) });
  }

  const worker = startOutboxWorker(async (event) => {
    try {
      await emitDomainEvent(event);
      state.lastHeartbeat = new Date();
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
      state.status = 'error';
      throw error;
    }
  }, OUTBOX_INTERVAL);

  state.status = 'running';
  state.startedAt = new Date();
  state.stop = () => worker.stop();

  // Heartbeat every 30s
  setInterval(async () => {
    if (state.status === 'running') {
      try {
        await recordWorkerHeartbeat('outbox');
        state.lastHeartbeat = new Date();
      } catch {
        // Non-fatal
      }
    }
  }, 30000);

  // Stats logging every 60s
  setInterval(async () => {
    if (state.status === 'running') {
      try {
        const stats = await getOutboxStats();
        logger.info('Outbox stats', stats);
      } catch {
        // Non-fatal
      }
    }
  }, 60000);

  logger.info('Outbox worker started');
}

async function startProjection(): Promise<void> {
  const state = workerStates.projection;
  logger.info('Starting projection worker');

  try {
    registerAllEventHandlers();
  } catch (error) {
    logger.warn('Failed to register event handlers', { error: error instanceof Error ? error.message : String(error) });
  }

  const worker = startProjectionWorker(PROJECTION_INTERVAL);

  state.status = 'running';
  state.startedAt = new Date();
  state.stop = () => worker.stop();

  // Heartbeat
  setInterval(async () => {
    if (state.status === 'running') {
      try {
        await recordWorkerHeartbeat('projection');
        state.lastHeartbeat = new Date();
      } catch {
        // Non-fatal
      }
    }
  }, 30000);

  logger.info('Projection worker started');
}

async function startPdf(): Promise<void> {
  const state = workerStates.pdf;
  logger.info('Starting PDF worker');

  try {
    // Dynamic import to avoid Redis issues if not needed
    const { Worker, Job } = await import('bullmq');
    const { default: Redis } = await import('ioredis');
    const { generatePeriodPdf, generateSinglePdf, savePdfBuffer } = await import('@/lib/pdf-generator');

    const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
    const CONCURRENCY = parseInt(process.env.PDF_WORKER_CONCURRENCY || '2', 10);

    const redisConnection = new Redis(REDIS_URL, {
      maxRetriesPerRequest: null,
      connectTimeout: 10000,
      keyPrefix: 'pilingtrack:',
      lazyConnect: true,
    });

    const pdfWorker = new Worker(
      'pdf-generation',
      async (job: InstanceType<typeof Job>) => {
        const data = job.data as Record<string, any>;
        const { type, dateFrom, dateTo, siteId, reportId, userId, reports, report } = data;
        const jobId = job.id as string;

        logger.info(`[PDF Worker] Processing job ${jobId}: type=${type}`);

        let pdfBuffer: Buffer;

        if (type === 'period') {
          pdfBuffer = await generatePeriodPdf({
            dateFrom,
            dateTo,
            siteId,
            reports: reports || [],
            totalPiles: data.totalPiles || 0,
            totalDrilling: data.totalDrilling || 0,
            totalDowntime: data.totalDowntime || 0,
          });
        } else if (type === 'single') {
          if (!report) {
            throw new Error('Single PDF requires report data in job');
          }
          pdfBuffer = await generateSinglePdf(report);
        } else {
          throw new Error(`Unknown PDF type: ${type}`);
        }

        const filePath = savePdfBuffer(jobId, pdfBuffer);
        logger.info(`[PDF Worker] Job ${jobId} completed: ${pdfBuffer.length} bytes`);

        return {
          jobId,
          filePath,
          fileSize: pdfBuffer.length,
          generatedAt: new Date().toISOString(),
        };
      },
      {
        connection: redisConnection,
        concurrency: CONCURRENCY,
        autorun: true,
      }
    );

    pdfWorker.on('completed', (job) => {
      logger.info(`[PDF] Job ${job.id} completed`);
      state.lastHeartbeat = new Date();
    });

    pdfWorker.on('failed', (job, err) => {
      const jobId = job?.id || 'unknown';
      logger.error(`[PDF] Job ${jobId} failed`, err);
      state.error = err.message;
      state.status = 'error';
    });

    pdfWorker.on('error', (err) => {
      logger.error('[PDF] Worker error', err);
      state.error = err.message;
    });

    state.status = 'running';
    state.startedAt = new Date();
    state.stop = async () => {
      await pdfWorker.close();
      await redisConnection.quit();
    };

    // Heartbeat
    setInterval(async () => {
      if (state.status === 'running') {
        try {
          await recordWorkerHeartbeat('pdf');
          state.lastHeartbeat = new Date();
        } catch {
          // Non-fatal
        }
      }
    }, 30000);

    logger.info('PDF worker started', { concurrency: CONCURRENCY });
  } catch (error) {
    state.status = 'error';
    state.error = error instanceof Error ? error.message : String(error);
    logger.error('Failed to start PDF worker', error);
  }
}

// ============================================================
// Graceful Shutdown
// ============================================================

let isShuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    logger.warn('Shutdown already in progress, forcing exit');
    process.exit(1);
  }

  isShuttingDown = true;
  logger.info(`Received ${signal}, shutting down gracefully`);

  // Stop all workers in parallel
  const stopPromises = Object.entries(workerStates)
    .filter(([, state]) => state.stop && state.status !== 'stopped')
    .map(async ([name, state]) => {
      try {
        logger.info(`Stopping ${name} worker`);
        state.status = 'stopped';
        if (typeof state.stop === 'function') {
          await state.stop();
        }
        logger.info(`${name} worker stopped`);
      } catch (error) {
        logger.error(`Error stopping ${name} worker`, error);
      }
    });

  await Promise.all(stopPromises);

  // Close health server
  if (healthServer) {
    healthServer.close(() => {
      logger.info('Health server closed');
    });
  }

  logger.info('All workers stopped, exiting');
  process.exit(0);
}

// ============================================================
// Main
// ============================================================

let healthServer: http.Server | null = null;

async function main(): Promise<void> {
  logger.info('Unified Worker Service starting');
  logger.info('Enabled workers', { enabled: ENABLED_WORKERS });
  logger.info('Health port', { port: HEALTH_PORT });

  // Start health check server
  healthServer = startHealthServer();

  // Start enabled workers
  const startPromises: Promise<void>[] = [];

  if (ENABLED_WORKERS.includes('outbox')) {
    startPromises.push(startOutbox());
  } else {
    workerStates.outbox.status = 'stopped';
  }

  if (ENABLED_WORKERS.includes('projection')) {
    startPromises.push(startProjection());
  } else {
    workerStates.projection.status = 'stopped';
  }

  if (ENABLED_WORKERS.includes('pdf')) {
    startPromises.push(startPdf());
  } else {
    workerStates.pdf.status = 'stopped';
  }

  await Promise.all(startPromises);

  logger.info('All workers started successfully');

  // Signal handling
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', error);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', reason);
  });
}

main().catch((error) => {
  logger.error('Worker service failed to start', error);
  process.exit(1);
});
