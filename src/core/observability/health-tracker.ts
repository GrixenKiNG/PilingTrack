/**
 * Health Tracker — Continuous System Health Monitoring
 *
 * Periodically probes all subsystems and caches the result
 * so the /api/system/status endpoint responds in < 500ms
 * even under degradation.
 *
 * Features:
 * - Background polling with configurable interval
 * - Per-check timeouts (DB 2s, Redis 1s)
 * - Worker heartbeat tracking via Redis
 * - Never throws — always returns a status
 *
 * Usage:
 *   import { startHealthTracker, getCurrentStatus, recordWorkerHeartbeat } from '@/core/observability/health-tracker';
 *
 *   // Call once at server startup
 *   startHealthTracker();
 *
 *   // In workers — call every 30s
 *   recordWorkerHeartbeat('outbox');
 */

import { db } from '@/lib/db';
import { getDatabaseProvider } from '@/lib/db';
import { getRedisClient } from '@/lib/redis-cache';
import { logger } from './logger';
import { getOutboxStats } from '@/services/reports/outbox-publisher';
import { getDlqStats } from '@/core/outbox/dead-letter-queue';
import { getLagMetrics, startLagMonitor, LagAlert } from './lag-monitor';

// ============================================================
// Types
// ============================================================

export type ComponentStatus = 'up' | 'down' | 'slow';
export type OutboxStatus = 'ok' | 'backlog' | 'stalled';
export type WorkerStatus = 'running' | 'stopped';
export type StorageProvider = 's3' | 'local';
export type OverallStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface ComponentHealth {
  status: ComponentStatus;
  latencyMs?: number;
}

export interface RedisHealth extends ComponentHealth {
  status: ComponentStatus;
}

export interface OutboxHealth {
  status: OutboxStatus;
  pendingCount: number;
  oldestPending?: string;
}

export interface WorkerHealth {
  status: WorkerStatus;
  lastHeartbeat?: string;
}

export interface StorageHealth {
  status: ComponentStatus;
  provider: StorageProvider;
}

export interface WebSocketHealth {
  status: ComponentStatus;
  connections?: number;
}

export interface BackupHealth {
  status: ComponentStatus;
  lastBackupAt?: string;
  lastBackupAgeHours?: number;
  lastBackupSize?: string;
  s3Synced?: boolean;
}

export interface SystemComponents {
  database: ComponentHealth;
  redis: RedisHealth;
  outbox: OutboxHealth;
  workers: WorkerHealth;
  storage: StorageHealth;
  websocket: WebSocketHealth;
  backup: BackupHealth;
}

export interface SystemMetrics {
  uptime: number;
  memoryUsage: NodeJS.MemoryUsage;
  outboxPending: number;
  dlqPending: number;
  activeWsConnections: number;
}

export interface SystemStatus {
  status: OverallStatus;
  timestamp: string;
  version: string;
  components: SystemComponents;
  metrics: SystemMetrics;
}

// ============================================================
// Thresholds
// ============================================================

const DB_SLOW_THRESHOLD_MS = 1000;
const REDIS_SLOW_THRESHOLD_MS = 500;
const OUTBOX_BACKLOG_THRESHOLD = 1000;
const OUTBOX_STALE_MS = 60 * 60 * 1000; // 1 hour
const WORKER_STALE_MS = 90 * 1000; // 90s (workers heartbeat every 30s)
const DB_CHECK_TIMEOUT_MS = 2000;
const REDIS_CHECK_TIMEOUT_MS = 1000;
const POLL_INTERVAL_MS = 15000; // check every 15s
const BACKUP_STALE_HOURS = 26;   // Alert if no backup in 26h
const BACKUP_CRITICAL_HOURS = 48; // Critical if no backup in 48h

// ============================================================
// Cached status (updated by background loop)
// ============================================================

let cachedStatus: SystemStatus | null = null;
let trackerStarted = false;

// ============================================================
// Timeout wrapper — rejects if promise takes too long
// ============================================================

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

// ============================================================
// Individual health checks
// ============================================================

async function checkDatabase(): Promise<ComponentHealth> {
  const start = Date.now();
  try {
    await withTimeout(
      db.$queryRaw`SELECT 1`,
      DB_CHECK_TIMEOUT_MS,
      'Database'
    );
    const latency = Date.now() - start;

    return {
      status: latency > DB_SLOW_THRESHOLD_MS ? 'slow' : 'up',
      latencyMs: latency,
    };
  } catch {
    return {
      status: 'down',
      latencyMs: Date.now() - start,
    };
  }
}

async function checkRedis(): Promise<RedisHealth> {
  const start = Date.now();
  try {
    const client = await getRedisClient();
    if (!client) {
      return { status: 'down' };
    }

    await withTimeout(
      client.ping(),
      REDIS_CHECK_TIMEOUT_MS,
      'Redis'
    );
    const latency = Date.now() - start;

    return {
      status: latency > REDIS_SLOW_THRESHOLD_MS ? 'slow' : 'up',
      latencyMs: latency,
    };
  } catch {
    return {
      status: 'down',
      latencyMs: Date.now() - start,
    };
  }
}

async function checkOutbox(): Promise<OutboxHealth> {
  try {
    const stats = await withTimeout(
      getOutboxStats(),
      DB_CHECK_TIMEOUT_MS,
      'Outbox stats'
    );

    const pendingCount = stats.unpublished;

    // Get oldest pending event
    let oldestPending: string | undefined;
    if (pendingCount > 0) {
      const oldest = await withTimeout(
        db.outboxEvent.findFirst({
          where: { published: false },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true },
        }),
        DB_CHECK_TIMEOUT_MS,
        'Oldest pending query'
      );

      if (oldest) {
        oldestPending = oldest.createdAt.toISOString();
      }
    }

    // Determine status
    if (pendingCount > OUTBOX_BACKLOG_THRESHOLD) {
      return { status: 'backlog', pendingCount, oldestPending };
    }

    if (oldestPending) {
      const age = Date.now() - new Date(oldestPending).getTime();
      if (age > OUTBOX_STALE_MS) {
        return { status: 'stalled', pendingCount, oldestPending };
      }
    }

    return { status: 'ok', pendingCount, oldestPending };
  } catch {
    return { status: 'stalled', pendingCount: -1 };
  }
}

async function checkWorkers(): Promise<WorkerHealth> {
  try {
    const client = await getRedisClient();
    if (!client) {
      return { status: 'stopped' };
    }

    // Read all worker heartbeats from Redis
    const workerNames = await client.smembers('system:workers');

    if (workerNames.length === 0) {
      // No workers registered — could be normal if workers not started yet
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

async function checkStorage(): Promise<StorageHealth> {
  const provider = getStorageProvider();

  if (provider === 'local') {
    return { status: 'up', provider: 'local' };
  }

  // S3 check
  try {
    const { getS3ClientForHealth } = await import('./s3-health-check');
    const ok = await withTimeout(
      getS3ClientForHealth(),
      DB_CHECK_TIMEOUT_MS,
      'S3 health'
    );

    return {
      status: ok ? 'up' : 'down',
      provider: 's3',
    };
  } catch {
    return { status: 'down', provider: 's3' };
  }
}

async function checkWebSocket(): Promise<WebSocketHealth> {
  try {
    const client = await getRedisClient();
    if (!client) {
      return { status: 'down' };
    }

    // Read WS connection count from Redis (set by WS server)
    const connCount = await client.get('system:ws:connections');
    const connections = connCount ? parseInt(connCount, 10) : 0;

    return {
      status: 'up',
      connections,
    };
  } catch {
    return { status: 'down' };
  }
}

async function checkBackup(): Promise<BackupHealth> {
  try {
    const client = await getRedisClient();
    if (!client) {
      return { status: 'down' };
    }

    // Read backup metadata from Redis (set by backup CronJob)
    const lastBackupAt = await client.get('system:backup:last_timestamp');
    const lastBackupSize = await client.get('system:backup:last_size');
    const s3Synced = await client.get('system:backup:s3_synced');

    if (!lastBackupAt) {
      // No backup metadata — either backup hasn't run yet or Redis lost data
      return { status: 'down' };
    }

    const backupTime = new Date(lastBackupAt).getTime();
    const ageMs = Date.now() - backupTime;
    const ageHours = Math.round((ageMs / (1000 * 60 * 60)) * 10) / 10;

    if (ageHours > BACKUP_CRITICAL_HOURS) {
      return {
        status: 'down',
        lastBackupAt,
        lastBackupAgeHours: ageHours,
        lastBackupSize: lastBackupSize || undefined,
        s3Synced: s3Synced === 'true',
      };
    }

    if (ageHours > BACKUP_STALE_HOURS) {
      return {
        status: 'slow',
        lastBackupAt,
        lastBackupAgeHours: ageHours,
        lastBackupSize: lastBackupSize || undefined,
        s3Synced: s3Synced === 'true',
      };
    }

    return {
      status: 'up',
      lastBackupAt,
      lastBackupAgeHours: ageHours,
      lastBackupSize: lastBackupSize || undefined,
      s3Synced: s3Synced === 'true',
    };
  } catch {
    return { status: 'down' };
  }
}

// ============================================================
// Storage provider detection
// ============================================================

function getStorageProvider(): StorageProvider {
  if (process.env.S3_BUCKET || process.env.S3_ACCESS_KEY_ID) {
    return 's3';
  }
  return 'local';
}

// ============================================================
// Aggregate status
// ============================================================

function computeOverallStatus(components: SystemComponents): OverallStatus {
  const { database, redis, outbox, workers, storage, websocket, backup } = components;

  // unhealthy: any down/stalled
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

  // degraded: any slow/backlog
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

// ============================================================
// Metrics snapshot
// ============================================================

async function collectMetrics(): Promise<SystemMetrics> {
  let outboxPending = 0;
  let dlqPending = 0;
  let activeWsConnections = 0;

  try {
    // Try lag monitor first (more detailed)
    const lagMetrics = getLagMetrics();
    if (lagMetrics) {
      outboxPending = lagMetrics.outboxPendingCount;
      dlqPending = lagMetrics.dlqPendingCount;
    } else {
      // Fallback to direct queries
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
    memoryUsage: typeof process !== 'undefined' ? process.memoryUsage() : {} as NodeJS.MemoryUsage,
    outboxPending,
    dlqPending,
    activeWsConnections,
  };
}

// ============================================================
// Full status check
// ============================================================

export async function checkSystemStatus(): Promise<SystemStatus> {
  const [database, redis, outbox, workers, storage, websocket, backup, metrics] =
    await Promise.allSettled([
      checkDatabase(),
      checkRedis(),
      checkOutbox(),
      checkWorkers(),
      checkStorage(),
      checkWebSocket(),
      checkBackup(),
      collectMetrics(),
    ]);

  const components: SystemComponents = {
    database: database.status === 'fulfilled' ? database.value : { status: 'down' },
    redis: redis.status === 'fulfilled' ? redis.value : { status: 'down' },
    outbox: outbox.status === 'fulfilled' ? outbox.value : { status: 'stalled', pendingCount: -1 },
    workers: workers.status === 'fulfilled' ? workers.value : { status: 'stopped' },
    storage: storage.status === 'fulfilled' ? storage.value : { status: 'down', provider: getStorageProvider() },
    websocket: websocket.status === 'fulfilled' ? websocket.value : { status: 'down' },
    backup: backup.status === 'fulfilled' ? backup.value : { status: 'down' },
  };

  const overallStatus = computeOverallStatus(components);

  return {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    version: typeof process !== 'undefined' ? process.env.npm_package_version || 'unknown' : 'unknown',
    components,
    metrics: metrics.status === 'fulfilled' ? metrics.value : {
      uptime: typeof process !== 'undefined' ? process.uptime() : 0,
      memoryUsage: typeof process !== 'undefined' ? process.memoryUsage() : {} as NodeJS.MemoryUsage,
      outboxPending: 0,
      dlqPending: 0,
      activeWsConnections: 0,
    },
  };
}

// ============================================================
// Background tracker
// ============================================================

function startBackgroundTracker(): void {
  if (trackerStarted) return;
  trackerStarted = true;

  // Start lag monitoring (runs independently)
  startLagMonitor({
    onAlert: (alert: LagAlert) => {
      // Log alerts — could also send to Telegram/PagerDuty
      logger[alert.level === 'critical' ? 'error' : 'warn'](`🚨 ${alert.message}`, {
        metric: alert.metric,
        value: alert.value,
        threshold: alert.threshold,
      });
    },
  });

  async function tick() {
    try {
      const status = await checkSystemStatus();
      cachedStatus = status;

      // Log status changes
      if (status.status !== 'healthy') {
        logger.warn('System health check', {
          status: status.status,
          database: status.components.database.status,
          redis: status.components.redis.status,
          outbox: status.components.outbox.status,
          workers: status.components.workers.status,
        });
      }
    } catch (err) {
      // Never let background errors crash the process
      logger.error('Health tracker tick failed', err);
    }

    // Schedule next tick
    setTimeout(tick, POLL_INTERVAL_MS);
  }

  // Run first check immediately
  tick();

  logger.info('Health tracker started', { intervalMs: POLL_INTERVAL_MS });
}

// ============================================================
// Worker heartbeat API
// ============================================================

/**
 * Record a worker heartbeat. Workers should call this every 30s.
 * @param workerName - e.g. 'outbox', 'projection', 'pdf'
 */
export async function recordWorkerHeartbeat(workerName: string): Promise<void> {
  try {
    const client = await getRedisClient();
    if (!client) return;

    const now = Date.now();
    await client.set(`system:worker:heartbeat:${workerName}`, String(now), 'EX', 120); // expire after 120s
    await client.sadd('system:workers', workerName);
  } catch (err) {
    logger.warn('Failed to record worker heartbeat', { workerName, error: err });
  }
}

/**
 * Update WebSocket connection count.
 * WS server should call this periodically.
 */
export async function setWsConnectionCount(count: number): Promise<void> {
  try {
    const client = await getRedisClient();
    if (!client) return;

    await client.set('system:ws:connections', String(count), 'EX', 60);
  } catch (err) {
    logger.warn('Failed to set WS connection count', { error: err });
  }
}

// ============================================================
// Public API
// ============================================================

/**
 * Get the most recent health status.
 * Returns cached result (updated every 15s) for fast response.
 */
export function getCurrentStatus(): SystemStatus | null {
  return cachedStatus;
}

/**
 * Start the background health tracker.
 * Call once at application startup.
 */
export function startHealthTracker(): void {
  startBackgroundTracker();
}

/**
 * Force an immediate fresh check (bypasses cache).
 * Use sparingly — this hits all subsystems.
 */
export async function getFreshStatus(): Promise<SystemStatus> {
  const status = await checkSystemStatus();
  cachedStatus = status;
  return status;
}
