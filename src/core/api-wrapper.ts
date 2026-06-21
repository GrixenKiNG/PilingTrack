import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { createHash } from 'crypto';
import { ServiceError } from '@/lib/service-error';
import { CircuitOpenError } from '@/core/infrastructure/circuit-breakers';
import { withCsrf } from '@/lib/csrf-protection';
import { rateLimiter, getRateLimitIdentifier } from '@/lib/rate-limiter';
import { logger } from '@/lib/logger';
import { getResponseCache } from '@/core/cache';
// eslint-disable-next-line no-restricted-imports -- legacy cross-layer import pending the parked services<->modules migration (CLAUDE.md); behavior-neutral
import { readSessionToken } from '@/services/auth/session-service';

export interface ApiWrapperOptions {
  domain?: string;
  cache?: boolean;
  cacheTTL?: number;
  /** Override the default 100/min mutation rate limit (e.g. for high-throughput sync). */
  rateLimit?: { maxAttempts: number; windowMs: number; blockDurationMs: number };
}

/** Map Prisma error codes to HTTP status. Only well-known codes listed. */
const PRISMA_STATUS: Record<string, number> = {
  P2025: 404, // Record not found
  P2002: 409, // Unique constraint violation
};

export function getSessionCacheScope(request: NextRequest): string | undefined {
  const sessionToken = readSessionToken(request);
  if (!sessionToken) return undefined;

  return createHash('sha256').update(sessionToken).digest('hex').slice(0, 24);
}

function isPrismaKnownError(err: unknown): err is { code: string; message: string } {
  if (typeof err !== 'object' || err === null || !('code' in err)) return false;
  const code = (err as { code: unknown }).code;
  return typeof code === 'string' && code.startsWith('P');
}

/**
 * Minimal API wrapper — catches ServiceError and Prisma errors, maps to HTTP status.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withApi<T extends any[]>(
  handler: (request: NextRequest, ...args: T) => Promise<NextResponse>,
  _opts?: ApiWrapperOptions
) {
  return async (request: NextRequest, ...args: T) => {
    try {
      if (
        _opts?.cache &&
        request.method === 'GET' &&
        !request.nextUrl.searchParams.has('_ts')
      ) {
        const domain = _opts.domain || 'unknown';
        const responseCache = getResponseCache(domain);
        const userScope = getSessionCacheScope(request);

        return await responseCache.getOrFetch(
          {
            endpoint: `${request.method}:${request.nextUrl.pathname}`,
            params: Object.fromEntries(request.nextUrl.searchParams.entries()),
            userId: userScope,
          },
          () => handler(request, ...args),
          { ttl: _opts.cacheTTL }
        );
      }

      return await handler(request, ...args);
    } catch (error: unknown) {
      if (error instanceof ServiceError) {
        return NextResponse.json(
          { error: error.message },
          { status: error.status }
        );
      }

      if (error instanceof CircuitOpenError) {
        const retryAfterSec = Math.ceil(error.retryAfterMs / 1000);
        return NextResponse.json(
          { error: 'Service temporarily unavailable', retryAfter: retryAfterSec },
          { status: 503, headers: { 'Retry-After': String(retryAfterSec) } }
        );
      }

      if (isPrismaKnownError(error)) {
        const status = PRISMA_STATUS[error.code];
        if (status) {
          return NextResponse.json(
            { error: error.code === 'P2025' ? 'Not found' : error.message },
            { status }
          );
        }
      }

      const domain = _opts?.domain || 'unknown';
      logger.error('API handler failed', error, { domain });
      Sentry.captureException(error, { tags: { domain, route: request.nextUrl.pathname } });
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }
  };
}

const MUTATION_RATE_LIMIT = { maxAttempts: 100, windowMs: 60_000, blockDurationMs: 60_000 };

/**
 * Wrap a mutation handler with CSRF check + rate limiting + error boundary.
 * Eliminates the need for per-route CSRF/rate-limit boilerplate.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withMutation<T extends any[]>(
  handler: (request: NextRequest, ...args: T) => Promise<NextResponse>,
  _opts?: ApiWrapperOptions
) {
  return withApi(async (request: NextRequest, ...args: T) => {
    const csrfCheck = withCsrf(request);
    if (csrfCheck) return csrfCheck;

    const identifier = getRateLimitIdentifier(request);
    const rl = await rateLimiter.check(identifier, _opts?.rateLimit ?? MUTATION_RATE_LIMIT);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter || 60) } }
      );
    }

    return handler(request, ...args);
  }, _opts);
}
