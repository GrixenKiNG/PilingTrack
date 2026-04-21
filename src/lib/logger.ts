/**
 * Structured Logger — JSON logging for production observability
 *
 * Outputs structured JSON logs suitable for:
 * - Log aggregation (ELK, Datadog, Grafana Loki)
 * - Log parsing and alerting
 * - Distributed tracing correlation
 *
 * Usage:
 *   import { logger } from '@/lib/logger';
 *   logger.info('Report created', { reportId, userId, siteId });
 *   logger.error('Database connection failed', { error: err.message });
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  service?: string;
  requestId?: string;
  userId?: string;
  siteId?: string;
  error?: string;
  stack?: string;
  durationMs?: number;
  [key: string]: unknown;
}

// Minimum level to output (filters out debug in production)
const MIN_LEVEL: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function getMinLevel(): LogLevel {
  const env = process.env.LOG_LEVEL;
  if (env && env in MIN_LEVEL) return env as LogLevel;
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

function formatEntry(
  level: LogLevel,
  message: string,
  data?: Record<string, unknown>
): string {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...data,
  };

  return JSON.stringify(entry);
}

function shouldLog(level: LogLevel): boolean {
  return MIN_LEVEL[level] >= MIN_LEVEL[getMinLevel()];
}

function log(level: LogLevel, message: string, data?: Record<string, unknown>) {
  if (!shouldLog(level)) return;

  const line = formatEntry(level, message, data);

  switch (level) {
    case 'error':
      console.error(line);
      break;
    case 'warn':
      console.warn(line);
      break;
    default:
      // eslint-disable-next-line no-console
      console.log(line);
  }
}

export const logger = {
  debug(message: string, data?: Record<string, unknown>) {
    log('debug', message, data);
  },

  info(message: string, data?: Record<string, unknown>) {
    log('info', message, data);
  },

  warn(message: string, data?: Record<string, unknown>) {
    log('warn', message, data);
  },

  error(message: string, error?: unknown, data?: Record<string, unknown>) {
    const errorData: Record<string, unknown> = { ...(data || {}) };
    if (error instanceof Error) {
      errorData.error = error.message;
      errorData.stack = error.stack;
    } else if (typeof error === 'string') {
      errorData.error = error;
    }
    log('error', message, errorData);
  },

  /**
   * Time an operation and log the duration.
   * Usage:
   *   const done = logger.time('Database query');
   *   await db.user.findMany(...);
   *   done(); // logs: {"message":"Database query","durationMs":42}
   */
  time(operation: string, data?: Record<string, unknown>): () => void {
    const start = Date.now();
    return () => {
      const durationMs = Date.now() - start;
      log('info', operation, { ...data, durationMs });
    };
  },
};

/**
 * Request logging middleware for API routes.
 * Wraps a handler function and logs request/response metadata.
 */
export async function withRequestLogging<T>(
  handler: () => Promise<T>,
  metadata: {
    method: string;
    path: string;
    requestId?: string;
    userId?: string;
  }
): Promise<T> {
  const { method, path, ...rest } = metadata;
  const done = logger.time(`${method} ${path}`, rest);

  try {
    const result = await handler();
    done();
    return result;
  } catch (error) {
    logger.error(`${method} ${path} failed`, error, rest);
    throw error;
  }
}
