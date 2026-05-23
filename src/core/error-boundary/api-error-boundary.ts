/**
 * API Error Boundary — Principal Engineer Pattern
 *
 * Purpose: Prevent cascading failures in API routes.
 * Unlike try/catch in every handler, this is a middleware-level
 * error boundary that:
 * 1. Catches ALL errors (sync + async)
 * 2. Classifies errors (user, system, downstream, timeout)
 * 3. Applies graceful degradation per service domain
 * 4. Returns consistent error responses with correlation IDs
 * 5. Tracks error rates for circuit breaker integration
 *
 * Architecture:
 * ┌──────────────────────────────────────────────────────┐
 * │ API Route Handler                                     │
 * │  ┌─────────────────────────────────────────────┐     │
 * │  │ ErrorBoundary Middleware                      │     │
 * │  │  ├── Classify error type                      │     │
 * │  │  ├── Apply degradation strategy               │     │
 * │  │  ├── Log with context (traceId, userId, etc) │     │
 * │  │  ├── Track error rate (for circuit breakers) │     │
 * │  │  └── Return structured error response         │     │
 * │  └─────────────────────────────────────────────┘     │
 * └──────────────────────────────────────────────────────┘
 *
 * Usage:
 *   // In any API route:
 *   export async function GET(request: NextRequest) {
 *     return withErrorBoundary(request, async (ctx) => {
 *       // Your handler logic — any error is caught
 *       return NextResponse.json({ data: ... });
 *     }, { domain: 'reports', degrade: returnEmptyList });
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { getCircuitBreakerHealth, CircuitOpenError } from '@/core/infrastructure/circuit-breakers';
import { recordError } from '@/core/observability/error-tracker';

// ============================================================
// Error Classification
// ============================================================

export type ErrorCategory =
  | 'user_error'        // 4xx — validation, auth, permissions
  | 'system_error'      // 5xx — bugs, unhandled exceptions
  | 'downstream_error'  // 503 — circuit breaker open, DB down
  | 'timeout_error'     // 504 — request timeout
  | 'rate_limit_error';  // 429 — too many requests

export interface ErrorContext {
  category: ErrorCategory;
  statusCode: number;
  message: string;
  userMessage: string;
  retryable: boolean;
  retryAfterMs?: number;
  domain: string;
  handler: string;
  traceId?: string;
  userId?: string;
  tenantId?: string;
  originalError?: Error;
  /** Cache key for last-known-good lookup in degradeWithCache. */
  cacheKey?: string;
}

/**
 * Classify an error into a category with appropriate response.
 */
export function classifyError(
  error: unknown,
  domain: string,
  handler: string,
  userId?: string,
  tenantId?: string
): ErrorContext {
  const traceId = (global as any).__traceId || 'unknown';

  // Circuit breaker open → downstream_error
  if (error instanceof CircuitOpenError) {
    return {
      category: 'downstream_error',
      statusCode: 503,
      message: error.message,
      userMessage: 'Сервис временно недоступен. Повторите запрос позже.',
      retryable: true,
      retryAfterMs: (error as CircuitOpenError).retryAfterMs,
      domain,
      handler,
      traceId,
      userId,
      tenantId,
      originalError: error as Error,
    };
  }

  // User errors (known business logic errors)
  if (error instanceof UserError) {
    return {
      category: 'user_error',
      statusCode: error.statusCode,
      message: error.message,
      userMessage: error.message,
      retryable: false,
      domain,
      handler,
      traceId,
      userId,
      tenantId,
      originalError: error,
    };
  }

  // Timeout errors
  if (error instanceof TimeoutError || (error instanceof Error && error.name === 'TimeoutError')) {
    return {
      category: 'timeout_error',
      statusCode: 504,
      message: error instanceof Error ? error.message : 'Request timeout',
      userMessage: 'Превышено время ожидания. Повторите запрос.',
      retryable: true,
      retryAfterMs: 5000,
      domain,
      handler,
      traceId,
      userId,
      tenantId,
      originalError: error as Error,
    };
  }

  // System errors (unexpected)
  return {
    category: 'system_error',
    statusCode: 500,
    message: error instanceof Error ? error.message : 'Unknown error',
    userMessage: 'Внутренняя ошибка сервера. Мы уже работаем над исправлением.',
    retryable: false,
    domain,
    handler,
    traceId,
    userId,
    tenantId,
    originalError: error instanceof Error ? error : new Error(String(error)),
  };
}

// ============================================================
// Degradation Strategies
// ============================================================

export type DegradationFn = (
  ctx: ErrorContext,
) => Promise<NextResponse | null> | NextResponse | null;

const LAST_KNOWN_GOOD_TTL_SECONDS = 300;
const LAST_KNOWN_GOOD_PREFIX = 'errboundary:lkg:';

/**
 * Record a successful response payload so degradeWithCache can serve it
 * on subsequent failures. Best-effort: silently no-ops if Redis is down.
 */
export async function recordLastKnownGood(cacheKey: string, data: unknown): Promise<void> {
  try {
    const { getRedisClient } = await import('@/lib/redis-cache');
    const client = await getRedisClient();
    if (!client) return;
    await client.set(
      `${LAST_KNOWN_GOOD_PREFIX}${cacheKey}`,
      JSON.stringify(data),
      'EX',
      LAST_KNOWN_GOOD_TTL_SECONDS,
    );
  } catch {
    // Cache writes are best-effort.
  }
}

/**
 * Return empty list — for query endpoints
 */
export const degradeEmptyList: DegradationFn = () =>
  NextResponse.json({ data: [], degraded: true });

/**
 * Return empty object — for detail endpoints
 */
export const degradeEmptyObject: DegradationFn = () =>
  NextResponse.json({ data: null, degraded: true });

/**
 * Return last-known-good cached response when the underlying handler fails.
 * Requires the route to populate the cache via recordLastKnownGood() after a
 * successful response, and to set ctx.cacheKey via ErrorBoundaryOptions.getCacheKey.
 */
export const degradeWithCache: DegradationFn = async (ctx) => {
  if (!ctx.cacheKey) {
    return NextResponse.json({ data: null, degraded: true, cached: false });
  }
  try {
    const { getRedisClient } = await import('@/lib/redis-cache');
    const client = await getRedisClient();
    if (!client) {
      return NextResponse.json({ data: null, degraded: true, cached: false });
    }
    const raw = await client.get(`${LAST_KNOWN_GOOD_PREFIX}${ctx.cacheKey}`);
    if (!raw) {
      return NextResponse.json({ data: null, degraded: true, cached: false });
    }
    return NextResponse.json({ data: JSON.parse(raw), degraded: true, cached: true });
  } catch {
    return NextResponse.json({ data: null, degraded: true, cached: false });
  }
};

/**
 * Return partial data — for aggregate endpoints
 */
export const degradePartial: DegradationFn = (ctx) =>
  NextResponse.json({ data: null, degraded: true, error: ctx.userMessage });

// ============================================================
// Error Boundary Middleware
// ============================================================

export interface ErrorBoundaryOptions {
  /** Domain name for tracking (e.g. 'reports', 'sites', 'auth') */
  domain: string;
  /** Handler name (e.g. 'GET /api/reports/all') */
  handler: string;
  /** Degradation strategy when errors occur */
  degrade?: DegradationFn;
  /** Track error rates for circuit breaker integration */
  trackErrors?: boolean;
  /** Log level for system errors */
  logLevel?: 'error' | 'warn' | 'info';
  /** Extract user ID from request context */
  getUserId?: (request: NextRequest) => string | undefined;
  /** Extract tenant ID from request context */
  getTenantId?: (request: NextRequest) => string | undefined;
  /** Build a cache key for degradeWithCache (e.g. route + userId + query) */
  getCacheKey?: (request: NextRequest) => string | undefined;
}

const DEFAULT_OPTIONS: Required<ErrorBoundaryOptions> = {
  domain: 'unknown',
  handler: 'unknown',
  degrade: degradePartial,
  trackErrors: true,
  logLevel: 'error',
  getUserId: () => undefined,
  getTenantId: () => undefined,
  getCacheKey: () => undefined,
};

/**
 * Wrap an API route handler with error boundary protection.
 */
export function withErrorBoundary<T>(
  request: NextRequest,
  handler: (ctx: {
    request: NextRequest;
    traceId: string;
    userId?: string;
    tenantId?: string;
  }) => Promise<NextResponse<T>>,
  options: ErrorBoundaryOptions
): Promise<NextResponse> {
  const opts: Required<ErrorBoundaryOptions> = { ...DEFAULT_OPTIONS, ...options };
  const traceId = (global as any).__traceId || crypto.randomUUID();
  const userId = opts.getUserId?.(request);
  const tenantId = opts.getTenantId?.(request);
  const cacheKey = opts.getCacheKey?.(request);

  return handler({ request, traceId, userId, tenantId }).catch(async (error) => {
    const errorCtx = classifyError(error, opts.domain, opts.handler, userId, tenantId);
    errorCtx.cacheKey = cacheKey;

    // Log appropriately
    if (errorCtx.category === 'system_error' || errorCtx.category === 'timeout_error') {
      logger[opts.logLevel]('API Error Boundary caught error', {
        category: errorCtx.category,
        domain: opts.domain,
        handler: opts.handler,
        traceId: errorCtx.traceId,
        userId: errorCtx.userId,
        tenantId: errorCtx.tenantId,
        error: errorCtx.originalError?.stack || errorCtx.message,
        circuitBreakers: getCircuitBreakerHealth(),
      });
    } else {
      logger.debug('API Error Boundary — user error', {
        category: errorCtx.category,
        domain: opts.domain,
        handler: opts.handler,
        message: errorCtx.message,
      });
    }

    // Track for circuit breaker / SLO
    if (opts.trackErrors && errorCtx.category !== 'user_error') {
      try {
        recordError({
          domain: opts.domain,
          error: errorCtx.originalError || new Error(errorCtx.message),
          context: {
            handler: opts.handler,
            traceId: errorCtx.traceId,
            userId: errorCtx.userId,
            tenantId: errorCtx.tenantId,
          },
        });
      } catch {
        // Non-fatal — don't let error tracking crash the response
      }
    }

    // Try degradation strategy (may be async, e.g. degradeWithCache)
    const degradedResponse = await opts.degrade(errorCtx);
    if (degradedResponse) {
      return degradedResponse;
    }

    // Default error response
    return NextResponse.json(
      {
        error: errorCtx.userMessage,
        traceId: errorCtx.traceId,
        retryable: errorCtx.retryable,
        retryAfterMs: errorCtx.retryAfterMs,
      },
      { status: errorCtx.statusCode }
    );
  });
}

// ============================================================
// Custom Error Types
// ============================================================

export class UserError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400
  ) {
    super(message);
    this.name = 'UserError';
  }
}

export class TimeoutError extends Error {
  constructor(message: string = 'Request timeout') {
    super(message);
    this.name = 'TimeoutError';
  }
}

// ============================================================
// Timeout Wrapper
// ============================================================

/**
 * Wrap a promise with a timeout. Rejects with TimeoutError.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message?: string
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new TimeoutError(message || `Timeout after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}
