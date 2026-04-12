/**
 * PDF Generation Worker — BullMQ background worker
 *
 * Processes PDF generation jobs from the 'pdf-generation' queue.
 * Calls the shared PDF generation logic and stores results on disk.
 *
 * Usage:
 *   npx tsx src/workers/pdf-worker.ts
 *
 * Or as a systemd service / Docker container in production.
 */

import { Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import { generatePeriodPdf, generateSinglePdf, savePdfBuffer, PeriodPdfData, SingleReportData } from '@/lib/pdf-generator';
import { PdfJobData, PdfJobResult } from '@/lib/pdf-queue';
import { logger } from '@/lib/logger';

// ============================================================
// Configuration
// ============================================================

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const QUEUE_NAME = 'pdf-generation';
const CONCURRENCY = parseInt(process.env.PDF_WORKER_CONCURRENCY || '2', 10);

// ============================================================
// Redis Connection
// ============================================================

function createRedisConnection(): Redis {
  return new Redis(REDIS_URL, {
    maxRetriesPerRequest: null, // BullMQ workers need this set to null
    connectTimeout: 10000,
    keyPrefix: 'pilingtrack:',
    lazyConnect: true,
  });
}

// ============================================================
// Worker
// ============================================================

async function processPdfJob(job: Job<PdfJobData, PdfJobResult>): Promise<PdfJobResult> {
  const { type, dateFrom, dateTo, siteId, reportId, userId } = job.data;
  const jobId = job.id as string;

  logger.info(`[PDF Worker] Processing job ${jobId}: type=${type}, userId=${userId}`);

  let pdfBuffer: Buffer;

  if (type === 'period') {
    const periodData = extractPeriodPdfData(job.data);
    pdfBuffer = await generatePeriodPdf(periodData);
  } else if (type === 'single') {
    const singleData = extractSingleReportData(job.data);
    if (!singleData) {
      throw new Error('Single PDF requires report data in job');
    }
    pdfBuffer = await generateSinglePdf(singleData);
  } else {
    throw new Error(`Unknown PDF type: ${type}`);
  }

  const filePath = savePdfBuffer(jobId, pdfBuffer);

  logger.info(`[PDF Worker] Job ${jobId} completed: ${pdfBuffer.length} bytes -> ${filePath}`);

  return {
    jobId,
    filePath,
    fileSize: pdfBuffer.length,
    generatedAt: new Date().toISOString(),
  };
}

function extractPeriodPdfData(data: PdfJobData): PeriodPdfData {
  return {
    dateFrom: data.dateFrom,
    dateTo: data.dateTo,
    siteId: data.siteId,
    reports: data.reports || [],
    totalPiles: data.totalPiles || 0,
    totalDrilling: data.totalDrilling || 0,
    totalDowntime: data.totalDowntime || 0,
  };
}

function extractSingleReportData(data: PdfJobData): SingleReportData | null {
  return data.report || null;
}

const workerConnection = createRedisConnection();

const pdfWorker = new Worker<PdfJobData, PdfJobResult>(
  QUEUE_NAME,
  processPdfJob,
  {
    connection: workerConnection,
    concurrency: CONCURRENCY,
    autorun: true,
  }
);

// ============================================================
// Event Listeners
// ============================================================

pdfWorker.on('completed', (job: Job) => {
  logger.info(`[PDF Worker] Job ${job.id} completed successfully`);
});

pdfWorker.on('failed', (job: Job | undefined, err: Error) => {
  const jobId = job?.id || 'unknown';
  logger.error(`[PDF Worker] Job ${jobId} failed`, err);
});

pdfWorker.on('error', (err: Error) => {
  logger.error(`[PDF Worker] Worker error`, err);
});

pdfWorker.on('stalled', (jobId: string) => {
  logger.warn(`[PDF Worker] Job ${jobId} stalled`);
});

// ============================================================
// Graceful Shutdown
// ============================================================

async function shutdown() {
  logger.info('[PDF Worker] Shutting down...');
  await pdfWorker.close();
  await workerConnection.quit();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// ============================================================
// Export for programmatic usage
// ============================================================

export { pdfWorker };

// ============================================================
// Main (when run directly)
// ============================================================

if (require.main === module) {
  logger.info(`[PDF Worker] Started with concurrency=${CONCURRENCY}`);
}
