import { getRedisClient } from '@/lib/redis-cache';
import { logger } from '../../logger';
import { WORKER_STALE_MS } from '../thresholds';
import type { WorkerHealth } from '../types';

export async function checkWorkers(): Promise<WorkerHealth> {
  try {
    const client = await getRedisClient();
    if (!client) {
      return { status: 'stopped' };
    }

    const workerNames = await client.smembers('system:workers');

    if (workerNames.length === 0) {
      return { status: 'stopped' };
    }

    let latestHeartbeat = 0;

    for (const name of workerNames) {
      const hb = await client.get(`system:worker:heartbeat:${name}`);
      if (hb) {
        const ts = parseInt(hb, 10);
        if (ts > latestHeartbeat) {
          latestHeartbeat = ts;
        }
      }
    }

    if (latestHeartbeat === 0) {
      return { status: 'stopped' };
    }

    const age = Date.now() - latestHeartbeat;
    const lastHbStr = new Date(latestHeartbeat).toISOString();

    if (age > WORKER_STALE_MS) {
      return { status: 'stopped', lastHeartbeat: lastHbStr };
    }

    return { status: 'running', lastHeartbeat: lastHbStr };
  } catch {
    return { status: 'stopped' };
  }
}

/**
 * Record a worker heartbeat. Workers should call this every 30s.
 * @param workerName - e.g. 'outbox', 'projection', 'pdf'
 */
export async function recordWorkerHeartbeat(workerName: string): Promise<void> {
  try {
    const client = await getRedisClient();
    if (!client) return;

    const now = Date.now();
    await client.set(`system:worker:heartbeat:${workerName}`, String(now), 'EX', 120);
    await client.sadd('system:workers', workerName);
  } catch (err) {
    logger.warn('Failed to record worker heartbeat', { workerName, error: err });
  }
}
