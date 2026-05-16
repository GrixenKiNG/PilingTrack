/**
 * Pino Logger — Production-Grade Structured Logging
 *
 * Features:
 * - JSON output for log aggregation (ELK, Datadog, Grafana Loki)
 * - Correlation ID via AsyncLocalStorage (request tracking)
 * - Child loggers with context (userId, siteId, tenantId)
 * - Pretty print in development, JSON in production
 * - Log levels: trace, debug, info, warn, error, fatal
 *
 * Usage:
 *   import { logger, childLogger } from '@/core/observability/logger';
 *   logger.info('Report created', { reportId, siteId });
 *   const reqLog = childLogger({ requestId: 'abc-123', userId: 'user-1' });
 *   reqLog.debug('Processing report');
 */

import pino, { Logger as PinoLogger, LoggerOptions } from 'pino';
import { AsyncLocalStorage } from 'async_hooks';

// ============================================================
// Correlation Context (AsyncLocalStorage)
// ============================================================

export interface CorrelationContext {
  requestId?: string;
  userId?: string;
  tenantId?: string;
  siteId?: string;
  spanId?: string;
  traceId?: string;
  [key: string]: unknown;
}

const correlationStorage = new AsyncLocalStorage<CorrelationContext>();

export function getCorrelationContext(): CorrelationContext | undefined {
  return correlationStorage.getStore();
}

export function runWithCorrelation<T>(
  ctx: CorrelationContext,
  fn: () => T
): T {
  const existing = correlationStorage.getStore() || {};
  return correlationStorage.run({ ...existing, ...ctx }, fn);
}

// ============================================================
// Pino Configuration
// ============================================================

function getPinoOptions(): LoggerOptions {
  const isProduction = process.env.NODE_ENV === 'production';
  type PinoLogMethod = (this: unknown, ...args: unknown[]) => unknown;

  return {
    level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
    hooks: {
      logMethod(inputArgs: unknown[], method: unknown) {
        // If first arg is a string, treat as message; otherwise as object
        if (inputArgs.length >= 2 && typeof inputArgs[0] === 'string') {
          const [message, ...rest] = inputArgs;
          const context = correlationStorage.getStore() || {};
          const data = rest.length > 0 ? (rest[0] as Record<string, unknown>) : undefined;
          return Reflect.apply(method as PinoLogMethod, this, [{ msg: message, ...context, ...data }]);
        }
        return Reflect.apply(method as PinoLogMethod, this, inputArgs);
      },
    },
  };
}

// ============================================================
// Logger Singleton
// ============================================================

const baseLogger: PinoLogger = pino(getPinoOptions());

export function logger(msg: string, obj?: Record<string, unknown>): void;
export function logger(obj: Record<string, unknown>): void;
export function logger(first: unknown, second?: Record<string, unknown>): void {
  if (typeof first === 'string') {
    baseLogger.info({ ...(correlationStorage.getStore() || {}), ...(second || {}) }, first as string);
  } else {
    baseLogger.info(first as Record<string, unknown>);
  }
}

logger.trace = (msg: string, obj?: Record<string, unknown>) =>
  baseLogger.trace({ ...(correlationStorage.getStore() || {}), ...(obj || {}) }, msg);
logger.debug = (msg: string, obj?: Record<string, unknown>) =>
  baseLogger.debug({ ...(correlationStorage.getStore() || {}), ...(obj || {}) }, msg);
logger.info = (msg: string, obj?: Record<string, unknown>) =>
  baseLogger.info({ ...(correlationStorage.getStore() || {}), ...(obj || {}) }, msg);
logger.warn = (msg: string, obj?: Record<string, unknown>) =>
  baseLogger.warn({ ...(correlationStorage.getStore() || {}), ...(obj || {}) }, msg);
logger.error = (msg: string, err?: unknown, obj?: Record<string, unknown>) => {
  const context = correlationStorage.getStore() || {};
  if (err instanceof Error) {
    baseLogger.error({ ...context, err, ...(obj || {}) }, msg);
  } else if (typeof err === 'string') {
    baseLogger.error({ ...context, error: err, ...(obj || {}) }, msg);
  } else if (err && typeof err === 'object') {
    baseLogger.error({ ...context, ...(err as Record<string, unknown>), ...(obj || {}) }, msg);
  } else {
    baseLogger.error({ ...context, ...(obj || {}) }, msg);
  }
};
logger.fatal = (msg: string, obj?: Record<string, unknown>) =>
  baseLogger.fatal({ ...correlationStorage.getStore(), ...obj }, msg);

// Timing helper
logger.time = (operation: string, data?: Record<string, unknown>) => {
  const start = Date.now();
  return () => {
    const durationMs = Date.now() - start;
    baseLogger.info({ ...correlationStorage.getStore(), ...data, durationMs, unit: 'ms' }, operation);
  };
};

// Child logger with context
export function childLogger(context: CorrelationContext): typeof logger {
  const child = baseLogger.child(context);

  const log: typeof logger = (msgOrObj: unknown, obj?: Record<string, unknown>) => {
    if (typeof msgOrObj === 'string') {
      child.info({ ...(correlationStorage.getStore() || {}), ...(obj || {}) }, msgOrObj);
    } else {
      child.info(msgOrObj as Record<string, unknown>);
    }
  };

  log.trace = (msg: string, data?: Record<string, unknown>) =>
    child.trace({ ...correlationStorage.getStore(), ...data }, msg);
  log.debug = (msg: string, data?: Record<string, unknown>) =>
    child.debug({ ...correlationStorage.getStore(), ...data }, msg);
  log.info = (msg: string, data?: Record<string, unknown>) =>
    child.info({ ...correlationStorage.getStore(), ...data }, msg);
  log.warn = (msg: string, data?: Record<string, unknown>) =>
    child.warn({ ...correlationStorage.getStore(), ...data }, msg);
  log.error = (msg: string, err?: unknown, data?: Record<string, unknown>) => {
    const ctx = { ...correlationStorage.getStore(), ...data };
    if (err instanceof Error) {
      child.error({ ...ctx, err }, msg);
    } else if (typeof err === 'string') {
      child.error({ ...ctx, error: err }, msg);
    } else if (err && typeof err === 'object') {
      child.error({ ...ctx, ...(err as Record<string, unknown>) }, msg);
    } else {
      child.error(ctx, msg);
    }
  };
  log.fatal = (msg: string, data?: Record<string, unknown>) =>
    child.fatal({ ...correlationStorage.getStore(), ...data }, msg);
  log.time = logger.time;

  return log;
}

// Export base pino instance for middleware integration
export { baseLogger };
export type { PinoLogger };
