/**
 * Уборка просроченных ключей идемпотентности (F-IDEMP-CLEANUP).
 *
 * У таблицы `IdempotencyKey` задуман срок жизни (7 суток, `idempotency.ts`),
 * но единственная функция очистки `cleanupExpiredKeys()` не вызывалась
 * ниоткуда: ключи копились вечно (R63 #4).
 *
 * Организация не нужна, и это осознанно. В миграциях 2026-08-19 и 2026-09-03
 * `IdempotencyKey` намеренно оставлена вне RLS: ключ проверяется до того, как
 * запрос дошёл до тенантного контекста, а строгая политика вернула бы ноль
 * строк (и удаление молча удалило бы ноль). Поэтому `cleanupExpiredKeys()`
 * вызывается один раз без контекста — под той же ролью, что и соседние
 * воркеры, и чистит ключи всех организаций разом. Условие удаления живёт
 * внутри `cleanupExpiredKeys` (просроченные / старше 7 суток); здесь ничего
 * дополнительно не фильтруется.
 *
 * Идемпотентно (повторный проход удалит ноль), поэтому выбора лидера не
 * требует — как pm-scheduler и projection-rebuild.
 *
 * Имя берётся из реестра (`health-tracker/scheduler-registry`): тем же именем
 * health-tracker решает, чей пульс истёк. Литерал, продублированный в воркере,
 * мог бы разойтись с реестром молча (F-SCHED-REGISTRY-IDEMP).
 */

import * as Sentry from '@sentry/nextjs';
import { logger } from '@/lib/logger';
import { cleanupExpiredKeys } from '@/core/security/idempotency';
import { IDEMPOTENCY_CLEANUP_SCHEDULER_NAME } from '@/core/observability/health-tracker/scheduler-registry';
import { recordSchedulerHeartbeat } from './scheduler-heartbeat';

const CLEANUP_INTERVAL = parseInt(
  process.env.IDEMPOTENCY_CLEANUP_INTERVAL_MS || String(24 * 60 * 60 * 1000),
  10,
);
const CLEANUP_STARTUP_DELAY = parseInt(
  process.env.IDEMPOTENCY_CLEANUP_STARTUP_DELAY_MS || '120000',
  10,
);

async function runOnce(): Promise<void> {
  try {
    const deleted = await cleanupExpiredKeys();
    logger.info('Idempotency keys cleanup pass', { deleted });
    await recordSchedulerHeartbeat(IDEMPOTENCY_CLEANUP_SCHEDULER_NAME, CLEANUP_INTERVAL);
  } catch (error) {
    logger.error('Idempotency keys cleanup pass failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    Sentry.captureException(error, { tags: { task: IDEMPOTENCY_CLEANUP_SCHEDULER_NAME } });
  }
}

/** Start the daily idempotency-key cleanup. Returns a stop fn that clears the timers. */
export function startIdempotencyCleanupScheduler(): () => void {
  logger.info('Arming idempotency cleanup scheduler', { intervalMs: CLEANUP_INTERVAL });
  const startupTimer = setTimeout(() => void runOnce(), CLEANUP_STARTUP_DELAY);
  const interval = setInterval(() => void runOnce(), CLEANUP_INTERVAL);
  return () => {
    clearTimeout(startupTimer);
    clearInterval(interval);
  };
}
