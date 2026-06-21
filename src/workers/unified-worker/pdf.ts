import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { generatePeriodPdf, generateSinglePdf, savePdfBuffer } from '@/lib/pdf-generator';
import { logger } from '@/lib/logger';
import { PDF_CONCURRENCY, REDIS_URL } from './config';
import {
  markHeartbeat,
  recordClusterHeartbeat,
  setError,
  setRunning,
  workerStates,
} from './state';

export async function startPdf(): Promise<void> {
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped external/library boundary
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
      // the worker process.
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
      if (state.status !== 'running') return;

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
