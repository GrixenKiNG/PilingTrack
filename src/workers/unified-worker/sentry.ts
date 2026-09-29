/**
 * Sentry для процесса воркера.
 *
 * Приложение инициализирует Sentry в корневом `sentry.server.config.ts`, который
 * подключает `src/instrumentation.ts` на старте Next. Отдельный процесс воркера
 * Next не запускает, поэтому тот же модуль подключается здесь: DSN, окружение,
 * семплирование и политика PII остаются едиными для app и workers — конфиг не
 * дублируется.
 *
 * Без SENTRY_DSN ничего не делаем: SDK остаётся no-op и не отправляет события.
 */

import { logger } from '@/lib/logger';

let initialized = false;

/** Подключает общий модуль инициализации Sentry. Идемпотентно. */
export async function initWorkerSentry(): Promise<void> {
  if (initialized) return;
  if (!process.env.SENTRY_DSN) return;

  initialized = true;

  try {
    // Тот же модуль, что и у сервера приложения (side-effect Sentry.init).
    await import('../../../sentry.server.config');
  } catch (error) {
    // Инициализация наблюдаемости не должна ронять процесс воркера.
    logger.warn('Sentry init failed in worker process', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
