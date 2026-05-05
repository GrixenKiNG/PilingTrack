import { getDlqStats } from '@/core/outbox/dead-letter-queue';
import { getOutboxStats } from '@/services/reports/outbox-publisher';
import { getRedisClient } from '@/lib/redis-cache';
import { getLagMetrics } from '../lag-monitor';
import { checkBackupStatus } from './checkers/backup';
import { checkDatabase } from './checkers/database';
import { checkOutbox } from './checkers/outbox';
import { checkRedis } from './checkers/redis';
import { checkStorage, getStorageProvider } from './checkers/storage';
import { checkWebSocket } from './checkers/websocket';
import { checkWorkers } from './checkers/workers';
import type {
  OverallStatus,
  SystemComponents,
  SystemMetrics,
  SystemStatus,
} from './types';

function computeOverallStatus(components: SystemComponents): OverallStatus {
  const { database, redis, outbox, workers, storage, websocket, backup } = components;

  if (
    database.status === 'down' ||
    redis.status === 'down' ||
    outbox.status === 'stalled' ||
    workers.status === 'stopped' ||
    storage.status === 'down' ||
    websocket.status === 'down' ||
    backup.status === 'down'
  ) {
    return 'unhealthy';
  }

  if (
    database.status === 'slow' ||
    redis.status === 'slow' ||
    outbox.status === 'backlog' ||
    backup.status === 'slow'
  ) {
    return 'degraded';
  }

  return 'healthy';
}

async function collectMetrics(): Promise<SystemMetrics> {
  let outboxPending = 0;
  let dlqPending = 0;
  let activeWsConnections = 0;

  try {
    const lagMetrics = getLagMetrics();
    if (lagMetrics) {
      outboxPending = lagMetrics.outboxPendingCount;
      dlqPending = lagMetrics.dlqPendingCount;
    } else {
      const [outboxStats, dlqStats] = await Promise.allSettled([
        getOutboxStats(),
        getDlqStats(),
      ]);

      if (outboxStats.status === 'fulfilled') {
        outboxPending = outboxStats.value.unpublished;
      }
      if (dlqStats.status === 'fulfilled') {
        dlqPending = dlqStats.value.pending;
      }
    }
  } catch {
    // best effort
  }

  try {
    const client = await getRedisClient();
    if (client) {
      const wsCount = await client.get('system:ws:connections');
      activeWsConnections = wsCount ? parseInt(wsCount, 10) : 0;
    }
  } catch {
    // best effort
  }

  return {
    uptime: typeof process !== 'undefined' ? process.uptime() : 0,
    memoryUsage:
      typeof process !== 'undefined' ? process.memoryUsage() : ({} as NodeJS.MemoryUsage),
    outboxPending,
    dlqPending,
    activeWsConnections,
  };
}

export async function checkSystemStatus(): Promise<SystemStatus> {
  const [database, redis, outbox, workers, storage, websocket, backup, metrics] =
    await Promise.allSettled([
      checkDatabase(),
      checkRedis(),
      checkOutbox(),
      checkWorkers(),
      checkStorage(),
      checkWebSocket(),
      checkBackupStatus(),
      collectMetrics(),
    ]);

  const components: SystemComponents = {
    database: database.status === 'fulfilled' ? database.value : { status: 'down' },
    redis: redis.status === 'fulfilled' ? redis.value : { status: 'down' },
    outbox:
      outbox.status === 'fulfilled' ? outbox.value : { status: 'stalled', pendingCount: -1 },
    workers: workers.status === 'fulfilled' ? workers.value : { status: 'stopped' },
    storage:
      storage.status === 'fulfilled'
        ? storage.value
        : { status: 'down', provider: getStorageProvider() },
    websocket: websocket.status === 'fulfilled' ? websocket.value : { status: 'down' },
    backup: backup.status === 'fulfilled' ? backup.value : { status: 'down' },
  };

  const overallStatus = computeOverallStatus(components);

  return {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    version:
      typeof process !== 'undefined' ? process.env.npm_package_version || 'unknown' : 'unknown',
    components,
    metrics:
      metrics.status === 'fulfilled'
        ? metrics.value
        : {
            uptime: typeof process !== 'undefined' ? process.uptime() : 0,
            memoryUsage:
              typeof process !== 'undefined'
                ? process.memoryUsage()
                : ({} as NodeJS.MemoryUsage),
            outboxPending: 0,
            dlqPending: 0,
            activeWsConnections: 0,
          },
  };
}
