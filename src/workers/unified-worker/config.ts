export type WorkerName = 'outbox' | 'projection' | 'pdf';
export type WorkerStatus = 'starting' | 'running' | 'error' | 'stopped';

export const HEALTH_PORT = parseInt(process.env.WORKER_HEALTH_PORT || '3002', 10);
export const OUTBOX_INTERVAL = parseInt(process.env.OUTBOX_INTERVAL_MS || '10000', 10);
export const PROJECTION_INTERVAL = parseInt(process.env.PROJECTION_INTERVAL_MS || '5000', 10);
export const PDF_CONCURRENCY = parseInt(process.env.PDF_WORKER_CONCURRENCY || '2', 10);
export const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export const ENABLED_WORKERS = (process.env.ENABLED_WORKERS || 'outbox,projection,pdf')
  .split(',')
  .map((name) => name.trim().toLowerCase())
  .filter(Boolean) as WorkerName[];
