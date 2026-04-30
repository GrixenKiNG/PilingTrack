/**
 * Unified worker service standalone runtime.
 *
 * Runs background workers in a dedicated process:
 * - outbox worker
 * - projection worker
 * - PDF queue worker
 *
 * Outbox and projection are leader-elected so a dedicated worker process can
 * coexist with embedded workers running inside the app server.
 */

import 'dotenv/config';
import http from 'http';
import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { emitDomainEvent } from '@/services/reports/domain-events';
import { getOutboxStats, startOutboxWorker } from '@/services/reports/outbox-publisher';
import { startProjectionWorker } from '@/modules/reports/application/projections/projection-worker';
import { registerAllEventHandlers } from '@/services/reports/event-handlers';
import { registerAllEventSchemas } from '@/core/event-bus/schema-registry';
import {
  getOutboxLeaderElection,
  getProjectionLeaderElection,
  LeaderElection,
} from '@/core/infrastructure/leader-election';
import { recordWorkerHeartbeat } from '@/core/observability/health-tracker';
import { logger } from '@/lib/logger';
import { generatePeriodPdf, generateSinglePdf, savePdfBuffer } from '@/lib/pdf-generator';

type WorkerName = 'outbox' | 'projection' | 'pdf';
type WorkerStatus = 'starting' | 'running' | 'error' | 'stopped';

interface WorkerState {
  name: WorkerName;
  status: WorkerStatus;
  lastHeartbeat: Date | null;
  error: string | null;
  startedAt: Date | null;
  isLeader: boolean;
  stop: (() => Promise<void>) | null;
}

const HEALTH_PORT = parseInt(process.env.WORKER_HEALTH_PORT || '3002', 10);
const OUTBOX_INTERVAL = parseInt(process.env.OUTBOX_INTERVAL_MS || '10000', 10);
const PROJECTION_INTERVAL = parseInt(process.env.PROJECTION_INTERVAL_MS || '5000', 10);
const PDF_CONCURRENCY = parseInt(process.env.PDF_WORKER_CONCURRENCY || '2', 10);
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const ENABLED_WORKERS = (process.env.ENABLED_WORKERS || 'outbox,projection,pdf')
  .split(',')
  .map((name) => name.trim().toLowerCase())
  .filter(Boolean) as WorkerName[];

const workerStates: Record<WorkerName, WorkerState> = {
  outbox: {
    name: 'outbox',
    status: 'starting',
    lastHeartbeat: null,
    error: null,
    startedAt: null,
    isLeader: false,
    stop: null,
  },
  projection: {
    name: 'projection',
    status: 'starting',
    lastHeartbeat: null,
    error: null,
    startedAt: null,
    isLeader: false,
    stop: null,
  },
  pdf: {
    name: 'pdf',
    status: 'starting',
    lastHeartbeat: null,
    error: null,
    startedAt: null,
    isLeader: false,
    stop: null,
  },
};

function markHeartbeat(state: WorkerState) {
  state.lastHeartbeat = new Date();
}

async function recordClusterHeartbeat(
  workerName: Extract<WorkerName, 'outbox' | 'projection' | 'pdf'>
): Promise<void> {
  await recordWorkerHeartbeat(workerName);
  markHeartbeat(workerStates[workerName]);
}

async function recordLeaderHeartbeat(
  workerName: Extract<WorkerName, 'outbox' | 'projection'>,
  election: LeaderElection
): Promise<void> {
  if (!election.isLeader()) {
    return;
  }

  await recordClusterHeartbeat(workerName);
}

function setRunning(state: WorkerState) {
  state.status = 'running';
  state.error = null;
  if (!state.startedAt) {
    state.startedAt = new Date();
  }
}

function setError(state: WorkerState, error: unknown) {
  state.status = 'error';
  state.error = error instanceof Error ? error.message : String(error);
}

function startHealthServer(): http.Server {
  const server = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/api/health') {
      const allWorkers = Object.values(workerStates);
      const runningWorkers = allWorkers.filter((worker) => worker.status === 'running');
      const errorWorkers = allWorkers.filter((worker) => worker.status === 'error');

      res.writeHead(errorWorkers.length > 0 ? 503 : runningWorkers.length > 0 ? 200 : 503, {
        'Content-Type': 'application/json',
      });
      res.end(
        JSON.stringify({
          status: errorWorkers.length > 0 ? 'degraded' : 'ok',
          uptime: process.uptime(),
          pid: process.pid,
          memory: process.memoryUsage(),
          workers: Object.fromEntries(
            allWorkers.map((worker) => [
              worker.name,
              {
                status: worker.status,
                leader: worker.isLeader,
                lastHeartbeat: worker.lastHeartbeat?.toISOString(),
                error: worker.error,
                uptime: worker.startedAt
                  ? Math.round((Date.now() - worker.startedAt.getTime()) / 1000)
                  : 0,
              },
            ])
          ),
        })
      );
      return;
    }

    if (req.url === '/metrics') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });

      const lines = Object.values(workerStates).flatMap((worker) => [
        `worker_status{name="${worker.name}"} ${worker.status === 'running' ? 1 : 0}`,
        `worker_is_leader{name="${worker.name}"} ${worker.isLeader ? 1 : 0}`,
        `worker_uptime_seconds{name="${worker.name}"} ${
          worker.startedAt ? Math.round((Date.now() - worker.startedAt.getTime()) / 1000) : 0
        }`,
      ]);

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

async function startOutbox(): Promise<void> {
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

  election.onBecomeLeader = () => {
    if (worker) {
      return;
    }

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

  const statsInterval = setInterval(() => {
    if (!election.isLeader()) {
      return;
    }

    void getOutboxStats()
      .then((stats) => {
        logger.info('Outbox stats', stats);
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

async function startProjection(): Promise<void> {
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
    if (worker) {
      return;
    }

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

async function startPdf(): Promise<void> {
  const state = workerStates.pdf;

  logger.info('Starting PDF worker', { concurrency: PDF_CONCURRENCY });

  try {
    const redisConnection = new Redis(REDIS_URL, {
      maxRetriesPerRequest: null,
      connectTimeout: 10_000,
      lazyConnect: true,
    });

    const pdfWorker = new Worker(
      'pdf-generation',
      async (job: InstanceType<typeof Job>) => {
        const data = job.data as Record<string, any>;
        const jobId = String(job.id);

        logger.info('PDF worker processing job', {
          jobId,
          type: data.type,
        });

        let pdfBuffer: Buffer;

        if (data.type === 'period') {
          pdfBuffer = await generatePeriodPdf({
            dateFrom: data.dateFrom,
            dateTo: data.dateTo,
            siteId: data.siteId,
            reports: data.reports || [],
            totalPiles: data.totalPiles || 0,
            totalDrilling: data.totalDrilling || 0,
            totalDowntime: data.totalDowntime || 0,
          });
        } else if (data.type === 'single') {
          if (!data.report) {
            throw new Error('Single PDF requires report data in job');
          }
          pdfBuffer = await generateSinglePdf(data.report);
        } else {
          throw new Error(`Unknown PDF type: ${String(data.type)}`);
        }

        const filePath = await savePdfBuffer(jobId, pdfBuffer);
        await recordClusterHeartbeat('pdf');

        return {
          jobId,
          filePath,
          fileSize: pdfBuffer.length,
          generatedAt: new Date().toISOString(),
        };
      },
      {
        connection: redisConnection,
        concurrency: PDF_CONCURRENCY,
        autorun: true,
        prefix: 'pilingtrack',
      }
    );

    pdfWorker.on('completed', (job) => {
      // Surface memory pressure: large period reports can spike heap usage in
      // the worker process. Logging RSS lets us correlate slowdowns with
      // specific job types/sizes during incident review.
      const mem = process.memoryUsage();
      logger.info('PDF job completed', {
        jobId: job.id,
        rssMb: Math.round(mem.rss / 1024 / 1024),
        heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      });
      markHeartbeat(state);
      // A single failed job must not leave the worker permanently marked unhealthy.
      if (state.status === 'error') {
        setRunning(state);
      }
    });

    pdfWorker.on('failed', (job, error) => {
      logger.error('PDF job failed', {
        jobId: job?.id ?? 'unknown',
        error: error.message,
      });
      // Per-job failure is expected; only record the last error, do not flip worker health.
      state.error = error.message;
    });

    pdfWorker.on('error', (error) => {
      logger.error('PDF worker error', {
        error: error.message,
      });
      setError(state, error);
    });

    setRunning(state);
    await recordClusterHeartbeat('pdf');

    const heartbeatInterval = setInterval(() => {
      if (state.status !== 'running') {
        return;
      }

      void recordClusterHeartbeat('pdf').catch((error) => {
        logger.error('PDF worker heartbeat failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, 30_000);

    state.stop = async () => {
      clearInterval(heartbeatInterval);
      state.status = 'stopped';
      await pdfWorker.close();
      await redisConnection.quit();
    };
  } catch (error) {
    setError(state, error);
    logger.error('Failed to start PDF worker', error);
  }
}

let isShuttingDown = false;
let healthServer: http.Server | null = null;

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
