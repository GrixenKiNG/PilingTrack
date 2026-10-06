/**
 * Sentry для процесса воркера.
 *
 * Приложение инициализирует Sentry в корневом `sentry.server.config.ts` через
 * `@sentry/nextjs`. Воркеру этот модуль подключать НЕЛЬЗЯ: `@sentry/nextjs`
 * при загрузке требует пакет `next` (`next/constants`), а образ workers
 * (`Dockerfile.workers`) удаляет `node_modules/next`. 01.10.2026 так и вышло:
 * воркер падал на старте с «Cannot find module 'next/constants'» и откачен на
 * прошлый образ. Поэтому здесь — `@sentry/node` той же версии (его тянет сам
 * `@sentry/nextjs`, в образе он есть) и те же настройки, что у сервера:
 * окружение, семплирование, политика PII.
 *
 * Без SENTRY_DSN ничего не делаем: SDK остаётся no-op и не отправляет события.
 */

import * as Sentry from '@sentry/node';
import { logger } from '@/lib/logger';

let initialized = false;

/** Инициализирует Sentry процесса воркера. Идемпотентно. */
export async function initWorkerSentry(): Promise<void> {
  if (initialized) return;
  if (!process.env.SENTRY_DSN) return;

  initialized = true;

  try {
    // Настройки — как в sentry.server.config.ts (не импортируем его, см. выше).
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      enabled: process.env.NODE_ENV === 'production',
      tracesSampleRate: 0.1,
      sendDefaultPii: false,
      enableLogs: false,
    });
  } catch (error) {
    // Инициализация наблюдаемости не должна ронять процесс воркера.
    logger.warn('Sentry init failed in worker process', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
