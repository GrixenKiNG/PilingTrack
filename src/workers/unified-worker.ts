/**
 * Unified worker service standalone runtime.
 *
 * Runs background workers in a dedicated process: outbox, projection, PDF.
 * Outbox and projection are leader-elected so a dedicated worker process can
 * coexist with embedded workers running inside the app server.
 *
 * Internal split under ./unified-worker/:
 *   config.ts         — env-based configuration + WorkerName/WorkerStatus types
 *   state.ts          — shared workerStates + heartbeat helpers
 *   health-server.ts  — HTTP /health + /metrics
 *   outbox.ts         — outbox worker startup + leader election wiring
 *   projection.ts     — projection worker startup + leader election wiring
 *   pdf.ts            — BullMQ PDF generation worker
 */

import 'dotenv/config';
import http from 'http';
import { logger } from '@/lib/logger';
import { db } from '@/lib/db';
import { closeRedisConnection } from '@/lib/redis-cache';
import { ENABLED_WORKERS, HEALTH_PORT } from './unified-worker/config';
import { positiveIntEnv } from './unified-worker/env-int';
import { startHealthServer } from './unified-worker/health-server';
import { startOutbox } from './unified-worker/outbox';
import { startPdf } from './unified-worker/pdf';
import { startPdfCleanupScheduler } from './unified-worker/pdf-cleanup-scheduler';
import { startProjection } from './unified-worker/projection';
import { startPmScheduler } from './unified-worker/pm-scheduler';
import { startProjectionRebuildScheduler } from './unified-worker/projection-rebuild-scheduler';
import { startReadinessScheduler } from './unified-worker/readiness-scheduler';
import { startIdempotencyCleanupScheduler } from './unified-worker/idempotency-cleanup-scheduler';
import { isIdempotencyCleanupEnabled } from '@/core/observability/health-tracker/scheduler-registry';
import { initWorkerSentry } from './unified-worker/sentry';
import { workerStates } from './unified-worker/state';

let isShuttingDown = false;
let healthServer: http.Server | null = null;
let stopPmScheduler: (() => void) | null = null;
let stopProjectionRebuild: (() => void) | null = null;
let stopReadinessScheduler: (() => void) | null = null;
let stopIdempotencyCleanup: (() => void) | null = null;
let stopPdfCleanup: (() => Promise<void>) | null = null;

// Предел на остановку. Docker после SIGTERM ждёт 10 с (stop_grace_period не
// задан) и присылает SIGKILL, поэтому свой дедлайн держим короче: зависшая
// stop-функция (задача PDF в работе, недоступный Redis) не должна превращать
// остановку в жёсткое убийство процесса.
const SHUTDOWN_TIMEOUT_MS = positiveIntEnv('WORKER_SHUTDOWN_TIMEOUT_MS', 8000);

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    logger.warn('Shutdown already in progress', { signal });
    process.exit(1);
  }

  isShuttingDown = true;
  logger.info('Received shutdown signal', { signal });

  const deadline = setTimeout(() => {
    logger.error('Shutdown deadline exceeded, forcing exit', {
      signal,
      timeoutMs: SHUTDOWN_TIMEOUT_MS,
    });
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

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

  if (stopPmScheduler) {
    stopPmScheduler();
    stopPmScheduler = null;
  }

  if (stopProjectionRebuild) {
    stopProjectionRebuild();
    stopProjectionRebuild = null;
  }

  if (stopReadinessScheduler) {
    stopReadinessScheduler();
    stopReadinessScheduler = null;
  }

  if (stopIdempotencyCleanup) {
    stopIdempotencyCleanup();
    stopIdempotencyCleanup = null;
  }

  if (stopPdfCleanup) {
    await stopPdfCleanup();
    stopPdfCleanup = null;
  }

  if (healthServer) {
    await new Promise<void>((resolve) => {
      healthServer?.close(() => resolve());
    });
  }

  // Соединения закрываем последними: воркеры и планировщики уже остановлены и
  // в Redis/БД не ходят. Иначе новый контейнер подхватит оборванные соединения
  // по таймауту, а не по чистому QUIT.
  try {
    await closeRedisConnection();
  } catch (error) {
    logger.error('Redis shutdown failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    await db.$disconnect();
  } catch (error) {
    logger.error('Prisma shutdown failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  clearTimeout(deadline);
  logger.info('Unified worker shutdown complete');
  process.exit(0);
}

async function main(): Promise<void> {
  // Наблюдаемость: ошибки фоновых задач должны уходить в Sentry, а не только
  // в docker-лог. Подключаем раньше планировщиков, чтобы их падения попали.
  await initWorkerSentry();

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

  // PM scheduler tick — idempotent daily job, no leader election needed.
  if (process.env.PM_SCHEDULER_ENABLED !== 'false') {
    stopPmScheduler = startPmScheduler();
  }

  // Projection rebuild safety-net — keeps analytics read-models fresh after a
  // dump restore / worker lag. Idempotent full recompute, no leader election.
  if (process.env.PROJECTION_REBUILD_ENABLED !== 'false') {
    stopProjectionRebuild = startProjectionRebuildScheduler();
  }

  // Суточный сброс техготовности: истечение нарядов и закрытие несданных
  // смен. Без него вчерашняя смена висит «в работе», а истёкший наряд
  // числится согласованным. Идемпотентен, выбора лидера не требует.
  if (process.env.READINESS_SCHEDULER_ENABLED !== 'false') {
    stopReadinessScheduler = startReadinessScheduler();
  }

  // Суточная уборка просроченных ключей идемпотентности: таблица задумана с
  // TTL 7 суток, но очистку никто не вызывал (R63 #4). Идемпотентна, лидера
  // не требует; организация не нужна — таблица намеренно вне RLS.
  //
  // Включение — только явным IDEMPOTENCY_CLEANUP_ENABLED='true'
  // (F-IDEMP-CLEANUP-OPTIN; прежнее «включено, пока не 'false'» снято).
  // По умолчанию выключено: у уборки открыта находка Codex (ревью out36,
  // R83 #1-2) — при перехвате зависшего `processing` `expiresAt` не
  // обновляется, и уборка может удалить АКТИВНЫЙ ключ. Включать только после
  // исправления src/core/security/idempotency.ts и добавления переменной в
  // docker-compose.yml: в сервис `workers` (там живёт планировщик) и в сервис
  // `app` (там /api/health/deep считает пульс). Сейчас её нет ни там, ни там.
  if (isIdempotencyCleanupEnabled()) {
    stopIdempotencyCleanup = startIdempotencyCleanupScheduler();
  }

  stopPdfCleanup = startPdfCleanupScheduler();

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
    // Node's state is undefined after an uncaught exception — exit and let
    // Docker restart the container rather than keep running degraded.
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection in unified worker', {
      reason: reason instanceof Error ? reason.message : String(reason),
    });
    // Same rationale as uncaughtException above — don't keep running degraded.
    process.exit(1);
  });
}

main().catch((error) => {
  logger.error('Unified worker service failed to start', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
