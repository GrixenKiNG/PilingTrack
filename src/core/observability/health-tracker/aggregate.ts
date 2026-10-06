import { getDlqStats } from '@/core/outbox/dead-letter-queue';
// eslint-disable-next-line no-restricted-imports -- legacy cross-layer import pending the parked services<->modules migration (CLAUDE.md); behavior-neutral
import { getOutboxStats } from '@/services/reports/outbox-publisher';
import { getLagMetrics } from '../lag-monitor';
import { checkBackupStatus } from './checkers/backup';
import { checkDatabase } from './checkers/database';
import { checkOutbox } from './checkers/outbox';
import { checkRedis } from './checkers/redis';
import { checkSchedulers } from './checkers/schedulers';
import { checkStorage, getStorageProvider } from './checkers/storage';
import { checkWorkers } from './checkers/workers';
import type {
  OverallStatus,
  SystemComponents,
  SystemMetrics,
  SystemStatus,
} from './types';

function computeOverallStatus(components: SystemComponents): OverallStatus {
  const { database, redis, outbox, workers, schedulers, storage, backup } = components;

  if (
    database.status === 'down' ||
    redis.status === 'down' ||
    outbox.status === 'stalled' ||
    workers.status === 'stopped' ||
    storage.status === 'down' ||
    backup.status === 'down'
  ) {
    return 'unhealthy';
  }

  if (
    database.status === 'slow' ||
    redis.status === 'slow' ||
    outbox.status === 'backlog' ||
    // Остановившийся планировщик — тихая потеря суточной рутины (R59 #2),
    // но приложение при этом работает: degraded, а не unhealthy, иначе
    // /api/health/deep отдавал бы 503 и мониторинг будил бы напрасно.
    schedulers.status === 'stale' ||
    storage.status === 'degraded' ||
    backup.status === 'slow'
  ) {
    return 'degraded';
  }

  return 'healthy';
}

async function collectMetrics(): Promise<SystemMetrics> {
  let outboxPending = 0;
  let dlqPending = 0;

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

  return {
    uptime: typeof process !== 'undefined' ? process.uptime() : 0,
    memoryUsage:
      typeof process !== 'undefined' ? process.memoryUsage() : ({} as NodeJS.MemoryUsage),
    outboxPending,
    dlqPending,
  };
}

export async function checkSystemStatus(): Promise<SystemStatus> {
  const [database, redis, outbox, workers, schedulers, storage, backup, metrics] =
    await Promise.allSettled([
      checkDatabase(),
      checkRedis(),
      checkOutbox(),
      checkWorkers(),
      checkSchedulers(),
      checkStorage(),
      checkBackupStatus(),
      collectMetrics(),
    ]);

  const components: SystemComponents = {
    database: database.status === 'fulfilled' ? database.value : { status: 'down' },
    redis: redis.status === 'fulfilled' ? redis.value : { status: 'down' },
    outbox:
      outbox.status === 'fulfilled' ? outbox.value : { status: 'stalled', pendingCount: -1 },
    workers: workers.status === 'fulfilled' ? workers.value : { status: 'stopped' },
    schedulers:
      schedulers.status === 'fulfilled' ? schedulers.value : { status: 'stale', stale: [] },
    storage:
      storage.status === 'fulfilled'
        ? storage.value
        : { status: 'down', provider: getStorageProvider() },
    backup: backup.status === 'fulfilled' ? backup.value : { status: 'down' },
  };

  const overallStatus = computeOverallStatus(components);

  return {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    version:
      typeof process !== 'undefined'
        ? process.env.APP_VERSION || process.env.npm_package_version || 'unknown'
        : 'unknown',
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
          },
  };
}
