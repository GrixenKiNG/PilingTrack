/**
 * Next.js server startup hooks.
 */

import { logger } from '@/lib/logger';

let startupDiagnosticsLogged = false;

function logEffectiveRuntimeFlags() {
  if (startupDiagnosticsLogged) {
    return;
  }

  startupDiagnosticsLogged = true;

  logger.info('Runtime log flags', {
    LOG_LEVEL: process.env.LOG_LEVEL ?? null,
    LOG_CACHE_STATS: process.env.LOG_CACHE_STATS ?? null,
    LOG_WORKER_STATS: process.env.LOG_WORKER_STATS ?? null,
    LOG_REDIS_LIFECYCLE: process.env.LOG_REDIS_LIFECYCLE ?? null,
    LOG_UNHANDLED_EVENTS: process.env.LOG_UNHANDLED_EVENTS ?? null,
    LOG_PROJECTION_SKIPS: process.env.LOG_PROJECTION_SKIPS ?? null,
    NODE_ENV: process.env.NODE_ENV ?? null,
    NEXT_RUNTIME: process.env.NEXT_RUNTIME ?? null,
  });
}

export async function register() {
  if (typeof process === 'undefined' || typeof process.on !== 'function') {
    return;
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    return;
  }

  if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
    throw new Error(
      'SESSION_SECRET is required in production. Set it to a random 64+ char string.'
    );
  }

  const isBuildPhase =
    process.env.NEXT_PHASE === 'phase-production-build' ||
    process.env.npm_lifecycle_event === 'build';

  if (isBuildPhase) {
    return;
  }

  logEffectiveRuntimeFlags();

  try {
    const { startEmbeddedWorkers } = await import('@/workers/embedded-workers');
    await startEmbeddedWorkers();
  } catch (err) {
    console.warn('[Instrumentation] Failed to start embedded workers:', err);
  }

  try {
    const { startHealthTracker } = await import('@/core/observability/health-tracker');
    startHealthTracker();
  } catch (err) {
    console.warn('[Instrumentation] Failed to start health tracker:', err);
  }
}
