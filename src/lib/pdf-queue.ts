/**
 * PDF Queue Client — BullMQ queue for asynchronous PDF generation
 *
 * Usage:
 *   import { enqueuePdfGeneration, getPdfJobStatus, downloadPdf } from '@/lib/pdf-queue';
 *
 *   // Enqueue a job
 *   const jobId = await enqueuePdfGeneration({ dateFrom, dateTo, siteId, type: 'period' });
 *
 *   // Check status
 *   const { status, result } = await getPdfJobStatus(jobId);
 *
 *   // Download when ready
 *   const pdfBuffer = await downloadPdf(jobId);
 */

import { Queue, Job, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import { readPdfResult } from '@/lib/pdf-generator';

// ============================================================
// Configuration
// ============================================================

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const QUEUE_NAME = 'pdf-generation';
const MAX_RETRIES = 2;
export const RESULTS_TTL = 60 * 60; // 1 hour (seconds, for Redis key expiry)

// ============================================================
// Redis Connection — with availability check
// ============================================================

let redisConnection: Redis | null = null;
let redisAvailable: boolean | null = null;

async function checkRedisAvailability(): Promise<boolean> {
  if (redisAvailable !== null) return redisAvailable;

  try {
    const testConn = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      lazyConnect: false,
    });
    await testConn.ping();
    await testConn.quit();
    redisAvailable = true;
    return true;
  } catch {
    redisAvailable = false;
    return false;
  }
}

function createRedisConnection(): Redis {
  if (!redisConnection) {
    redisConnection = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      connectTimeout: 10000,
      keyPrefix: 'pilingtrack:',
      lazyConnect: true,
    });

    redisConnection.on('error', () => {
      redisAvailable = false;
    });
    redisConnection.on('ready', () => {
      redisAvailable = true;
    });
  }
  return redisConnection;
}

export function isRedisAvailable(): boolean {
  return redisAvailable === true;
}

// Lazy init — only create connection when actually needed
let pdfQueueInstance: Queue | null = null;
let pdfQueueEventsInstance: QueueEvents | null = null;

function getQueue(): Queue {
  if (!pdfQueueInstance) {
    const connection = createRedisConnection();
    pdfQueueInstance = new Queue(QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        attempts: MAX_RETRIES,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: { age: RESULTS_TTL, count: 1000 },
        removeOnFail: { age: 24 * 3600, count: 5000 },
      },
    });
  }
  return pdfQueueInstance;
}

function getQueueEvents(): QueueEvents {
  if (!pdfQueueEventsInstance) {
    const connection = createRedisConnection();
    pdfQueueEventsInstance = new QueueEvents(QUEUE_NAME, { connection });
  }
  return pdfQueueEventsInstance;
}

// ============================================================
// Job Data Types
// ============================================================

export interface PdfJobData {
  dateFrom: string;
  dateTo: string;
  siteId: string;
  type: 'period' | 'single';
  reportId?: string;
  userId: string;
  // Period report extras (passed from the route after fetching data)
  reports?: unknown[];
  totalPiles?: number;
  totalDrilling?: number;
  totalDowntime?: number;
  // Single report data (passed from the route after fetching data)
  report?: {
    reportId: string;
    date: string;
    shiftStart: string | null;
    shiftEnd: string | null;
    shiftType: string;
    status: string;
    lastEditedByName: string | null;
    lastEditedByRole: string | null;
    assistantName: string;
    equipmentName: string;
    user: { name: string } | null;
    site: { name: string } | null;
    piles: { pileGrade: { name: string }; count: number }[];
    drillings: { type: { name: string }; meters: number }[];
    downtimes: { reason: { name: string }; duration: number; comment: string | null }[];
  };
}

export interface PdfJobResult {
  jobId: string;
  filePath: string;
  fileSize: number;
  generatedAt: string;
}

// ============================================================
// Public API
// ============================================================

/**
 * Enqueue a PDF generation job. Returns the jobId.
 * Falls back to null if Redis is unavailable — caller should use sync mode.
 */
export async function enqueuePdfGeneration(jobData: PdfJobData): Promise<string | null> {
  const available = await checkRedisAvailability();
  if (!available) {
    console.warn('[PDF Queue] Redis unavailable, enqueuePdfGeneration returns null — use sync fallback');
    return null;
  }

  try {
    const queue = getQueue();
    const job = await queue.add(QUEUE_NAME, jobData, {
      jobId: undefined,
    });
    return job.id as string;
  } catch (err) {
    console.error('[PDF Queue] Failed to enqueue job:', err);
    return null;
  }
}

/**
 * Get the status of a PDF generation job.
 * Returns { status: 'queued' | 'active' | 'completed' | 'failed', result? }
 */
export async function getPdfJobStatus(
  jobId: string
): Promise<{
  status: 'queued' | 'active' | 'completed' | 'failed' | 'not-found';
  result?: PdfJobResult;
  failedReason?: string;
}> {
  const job = await Job.fromId(getQueue(), jobId);

  if (!job) {
    return { status: 'not-found' };
  }

  const state = await job.getState();

  if (state === 'completed' && job.returnvalue) {
    return { status: 'completed', result: job.returnvalue as PdfJobResult };
  }

  if (state === 'failed') {
    return {
      status: 'failed',
      failedReason: job.failedReason || 'Unknown error',
    };
  }

  if (state === 'active') {
    return { status: 'active' };
  }

  // 'waiting', 'delayed', 'prioritized', 'paused'
  return { status: 'queued' };
}

/**
 * Download a completed PDF by jobId.
 * Throws if the job is not completed.
 */
export async function downloadPdf(jobId: string): Promise<Buffer> {
  const { status, result } = await getPdfJobStatus(jobId);

  if (status !== 'completed' || !result) {
    throw new Error(`PDF not ready yet. Status: ${status}`);
  }

  return readPdfResult(jobId);
}

/**
 * Get queue metrics.
 */
export async function getQueueMetrics(): Promise<{
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}> {
  const queue = getQueue();
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ]);

  return { waiting, active, completed, failed, delayed };
}

/**
 * Graceful shutdown. Safe to call even if the queue was never initialised
 * (e.g. Redis unavailable at boot) — we only close instances that exist.
 */
export async function closePdfQueue(): Promise<void> {
  if (pdfQueueInstance) {
    await pdfQueueInstance.close();
    pdfQueueInstance = null;
  }
  if (pdfQueueEventsInstance) {
    await pdfQueueEventsInstance.close();
    pdfQueueEventsInstance = null;
  }
  if (redisConnection) {
    await redisConnection.quit();
    redisConnection = null;
  }
}
