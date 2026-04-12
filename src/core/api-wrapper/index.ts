/**
 * API Route Wrapper — Error Boundary + SLO + Bulkhead + Cache
 *
 * One-liner wrapper that applies all production-grade patterns:
 *   withApi(request, handler, { domain: 'reports', cache: true })
 *
 * Applies in order:
 *   1. Bulkhead (concurrency limit per domain)
 *   2. Response Cache (if cache: true)
 *   3. Error Boundary (catch all errors)
 *   4. SLO Tracking (record request latency/success)
 *
 * Usage:
 *   import { withApi } from '@/core/api-wrapper';
 *
 *   // Read endpoint — cached, with SLO
 *   export const GET = withApi(
 *     async (request) => {
 *       return NextResponse.json({ sites: await getAccessibleSites(...) });
 *     },
 *     { domain: 'sites', cache: true, cacheTTL: 30_000 }
 *   );
 *
 *   // Write endpoint — error boundary + SLO only
 *   export const POST = withApi(
 *     async (request) => {
 *       await createReport(...);
 *       return NextResponse.json({ ok: true });
 *     },
 *     { domain: 'reports', cache: false }
 *   );
 */

import { NextRequest, NextResponse } from 'next/server';
import { getBulkhead, withErrorBoundary, degradeEmptyList, degradePartial, type ErrorBoundaryOptions } from '@/core/error-boundary';
import { getResponseCache, type CacheKey } from '@/core/cache';
import { withSLOTracking, type SLOTrackingOptions } from '@/core/observability';
import { withDbProtection, CircuitOpenError } from '@/core/infrastructure/circuit-breakers';
import { logger } from '@/lib/logger';

// ============================================================
// Wrapper Config
// ============================================================

export interface ApiWrapperOptions {
  /** Domain for bulkhead/SLO/cache scoping */
  domain: string;
  /** Enable response caching (GET only) */
  cache?: boolean;
  /** Cache TTL in ms (default: 30s) */
  cacheTTL?: number;
  /** Cache key params (default: uses query params) */
  cacheParams?: Record<string, unknown>;
  /** SLO target override */
  sloTarget?: number;
  /** Degradation strategy on error */
  degrade?: ErrorBoundaryOptions['degrade'];
  /** Handler name for error tracking */
  handlerName?: string;
}

// ============================================================
// Response Normalizer — strict boundary
// ============================================================

/**
 * Normalize any Response/NextResponse to NextResponse.
 * Ensures contract compatibility for cache/SLO/bulkhead layers.
 */
function toNextResponse(res: Response | NextResponse): NextResponse {
  if (res instanceof NextResponse) {
    return res;
  }

  return new NextResponse(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}

// ============================================================
// Core Wrapper
// ============================================================

type HandlerFn = (request: NextRequest) => Promise<Response | NextResponse>;

/**
 * Wrap an API handler with all production-grade patterns.
 */
export function withApi(
  handler: HandlerFn,
  options: ApiWrapperOptions
): (request: NextRequest) => Promise<NextResponse> {
  const {
    domain,
    cache = false,
    cacheTTL = 30_000,
    cacheParams,
    sloTarget,
    degrade = degradePartial,
    handlerName,
  } = options;

  const bulkhead = getBulkhead(domain);
  const responseCache = getResponseCache(domain);

  // Build the wrapped handler
  const wrappedHandler: HandlerFn = async (request: NextRequest) => {
    // For GET requests with caching, use response cache
    if (cache && request.method === 'GET') {
      const cacheKey: CacheKey = {
        endpoint: `${domain}:${request.nextUrl.pathname}`,
        params: cacheParams || Object.fromEntries(request.nextUrl.searchParams.entries()),
        tenantId: request.headers.get('x-tenant-id') || undefined,
      };

      return responseCache.getOrFetch(cacheKey, async () => {
        const result = await bulkhead.execute(() => handler(request));
        return toNextResponse(result);
      }, { ttl: cacheTTL });
    }

    // Non-cached: just execute through bulkhead
    const result = await bulkhead.execute(() => handler(request));
    return toNextResponse(result);
  };

  // Apply SLO tracking
  const sloWrapped = (request: NextRequest) =>
    withSLOTracking(request, async () => {
      const result = await wrappedHandler(request);
      return toNextResponse(result);
    }, {
      domain,
      target: sloTarget,
    });

  // Apply error boundary
  return (request: NextRequest) =>
    withErrorBoundary(request, () => sloWrapped(request), {
      domain,
      handler: handlerName || 'unknown',
      degrade,
    });
}

// ============================================================
// Convenience: Cache Invalidation Helper
//
export function invalidateDomainCache(domain: string, scope?: { tenantId?: string }): void {
  const responseCache = getResponseCache(domain);
  responseCache.invalidate(domain, scope);
  logger.info('Cache invalidated', { domain, scope });
}

// ============================================================
// withMutation — Circuit Breaker + Error Boundary for Mutations
// ============================================================

/**
 * Wrap a mutation handler with:
 * 1. Database Circuit Breaker — fast-fail 503 when DB is down
 * 2. Error Boundary — catch all errors
 * 3. SLO Tracking
 *
 * Usage:
 *   export const POST = withMutation(
 *     async (request) => {
 *       await createReport(...);
 *       return NextResponse.json({ ok: true });
 *     },
 *     { domain: 'reports' }
 *   );
 */
export function withMutation(
  handler: HandlerFn,
  options: ApiWrapperOptions
): (request: NextRequest) => Promise<NextResponse> {
  const {
    domain,
    sloTarget,
    handlerName,
  } = options;

  const wrappedHandler: HandlerFn = async (request: NextRequest) => {
    return withDbProtection(async () => {
      const result = await handler(request);
      return toNextResponse(result);
    });
  };

  // Apply SLO tracking
  const sloWrapped = (request: NextRequest) =>
    withSLOTracking(request, async () => {
      const result = await wrappedHandler(request);
      return toNextResponse(result);
    }, {
      domain,
      target: sloTarget,
    });

  // Apply error boundary with CircuitOpenError handling
  return (request: NextRequest) =>
    withErrorBoundary(request, async () => {
      try {
        return await sloWrapped(request);
      } catch (error) {
        if (error instanceof CircuitOpenError) {
          const retryAfterSec = Math.ceil(error.retryAfterMs / 1000);
          return NextResponse.json(
            {
              error: 'Database temporarily unavailable',
              retryAfter: retryAfterSec,
            },
            {
              status: 503,
              headers: { 'Retry-After': String(retryAfterSec) },
            }
          );
        }
        throw error; // Re-throw for error boundary
      }
    }, {
      domain,
      handler: handlerName || `${domain}:mutation`,
      degrade: degradePartial,
    });
}
