import { positiveIntEnv } from './env-int';

export type WorkerName = 'outbox' | 'projection' | 'pdf';
export type WorkerStatus = 'starting' | 'running' | 'error' | 'stopped';

export const HEALTH_PORT = positiveIntEnv('WORKER_HEALTH_PORT', 3002, { max: 65535 });
export const OUTBOX_INTERVAL = positiveIntEnv('OUTBOX_INTERVAL_MS', 10000);
export const PROJECTION_INTERVAL = positiveIntEnv('PROJECTION_INTERVAL_MS', 5000);
export const PDF_CONCURRENCY = positiveIntEnv('PDF_WORKER_CONCURRENCY', 2);
export const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

export const ENABLED_WORKERS = (process.env.ENABLED_WORKERS || 'outbox,projection,pdf')
  .split(',')
  .map((name) => name.trim().toLowerCase())
  .filter(Boolean) as WorkerName[];
