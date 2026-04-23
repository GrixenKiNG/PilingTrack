/**
 * Response Cache with Request Coalescing — BFF Layer
 *
 * Principal Engineer design:
 * 1. In-memory LRU cache with TTL per endpoint
 * 2. Request coalescing — identical concurrent requests → single DB query
 * 3. Stale-while-revalidate — serve stale data while refreshing
 * 4. Cache invalidation on mutations (by entity type)
 * 5. Per-tenant cache isolation
 *
 * Architecture:
 * ┌──────────────────────────────────────────────────────┐
 * │ API Request                                           │
 * │  ↓                                                    │
 * │  Cache Check → HIT → Return cached                   │
 * │  ↓ MISS                                               │
 * │  Coalescing Check → IN_FLIGHT → Wait for result      │
 * │  ↓ NEW                                                │
 * │  Execute handler → Cache result → Return              │
 * └──────────────────────────────────────────────────────┘
 *
 * Usage:
 *   const cache = createResponseCache({ defaultTTL: 30_000 });
 *
 *   export async function GET(request: NextRequest) {
 *     return cache.getOrFetch('reports:list', { tenantId }, async () => {
 *       return NextResponse.json(await db.report.findMany(...));
 *     });
 *   }
 *
 *   // On mutation:
 *   cache.invalidate('reports', { tenantId });
 */

import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

// ============================================================
// Types
// ============================================================

export interface CacheConfig {
  defaultTTL: number;          // ms (default: 30s)
  maxEntries: number;          // LRU limit (default: 500)
  staleWhileRevalidate: number; // ms after TTL (default: 60s)
}

export interface CacheKey {
  endpoint: string;
  params?: Record<string, unknown>;
  tenantId?: string;
  userId?: string;
}

interface CacheEntry<T = unknown> {
  value: T;
  createdAt: number;
  lastAccessedAt: number;
  hitCount: number;
  isStale: boolean;
}

interface InFlightRequest<T = unknown> {
  promise: Promise<T>;
  startedAt: number;
}

// ============================================================
// Cache Key Generation
// ============================================================

function serializeParams(params?: Record<string, unknown>): string {
  if (!params) return '';
  const sorted = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(sorted);
}

export function cacheKeyToString(key: CacheKey): string {
  const parts = [key.endpoint];
  if (key.tenantId) parts.push(`t:${key.tenantId}`);
  if (key.userId) parts.push(`u:${key.userId}`);
  const params = serializeParams(key.params);
  if (params) parts.push(`p:${params}`);
  return parts.join('|');
}

function cloneResponse<T>(response: NextResponse<T>): NextResponse<T> {
  return response.clone() as NextResponse<T>;
}

// ============================================================
// Response Cache
// ============================================================

export class ResponseCache {
  private cache = new Map<string, CacheEntry>();
  private inFlight = new Map<string, InFlightRequest>();
  private config: CacheConfig;

  constructor(config?: Partial<CacheConfig>) {
    this.config = {
      defaultTTL: config?.defaultTTL ?? 30_000,
      maxEntries: config?.maxEntries ?? 500,
      staleWhileRevalidate: config?.staleWhileRevalidate ?? 60_000,
    };

    // LRU eviction check every 30s
    setInterval(() => this.evict(), 30_000);
  }

  /**
   * Get from cache or execute the fetch function.
   * Handles coalescing of identical concurrent requests.
   */
  async getOrFetch<T>(
    key: CacheKey,
    fetchFn: () => Promise<NextResponse<T>>,
    options?: { ttl?: number }
  ): Promise<NextResponse<T>> {
    const cacheKey = cacheKeyToString(key);
    const ttl = options?.ttl ?? this.config.defaultTTL;
    const now = Date.now();

    // 1. Check cache
    const entry = this.cache.get(cacheKey);
    if (entry) {
      entry.lastAccessedAt = now;
      entry.hitCount++;

      const age = now - entry.createdAt;

      if (age < ttl) {
        // Fresh — return immediately
        return cloneResponse(entry.value as NextResponse<T>);
      }

      if (age < ttl + this.config.staleWhileRevalidate) {
        // Stale but revalidatable — serve stale + refresh in background
        entry.isStale = true;
        this.refreshInBackground(cacheKey, key, fetchFn, ttl);
        return cloneResponse(entry.value as NextResponse<T>);
      }

      // Expired — remove and re-fetch
      this.cache.delete(cacheKey);
    }

    // 2. Check in-flight (request coalescing)
    const inFlight = this.inFlight.get(cacheKey);
    if (inFlight) {
      // Wait for the existing request to complete
      try {
        const value = await inFlight.promise as NextResponse<T>;
        return cloneResponse(value);
      } catch {
        // In-flight failed — retry
        this.inFlight.delete(cacheKey);
      }
    }

    // 3. Execute and cache
    const promise = this.executeAndCache(cacheKey, fetchFn, ttl);
    this.inFlight.set(cacheKey, { promise, startedAt: now });

    try {
      const result = await promise;
      return result;
    } finally {
      this.inFlight.delete(cacheKey);
    }
  }

  /**
   * Execute the fetch function and store result in cache.
   */
  private async executeAndCache<T>(
    cacheKey: string,
    fetchFn: () => Promise<NextResponse<T>>,
    ttl: number
  ): Promise<NextResponse<T>> {
    const value = await fetchFn();

    // LRU check
    if (this.cache.size >= this.config.maxEntries) {
      this.evict();
    }

    this.cache.set(cacheKey, {
      value: cloneResponse(value) as any,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      hitCount: 0,
      isStale: false,
    });

    return cloneResponse(value);
  }

  /**
   * Refresh cache entry in background (stale-while-revalidate).
   */
  private async refreshInBackground<T>(
    cacheKey: string,
    key: CacheKey,
    fetchFn: () => Promise<NextResponse<T>>,
    ttl: number
  ): Promise<void> {
    // Don't refresh if already refreshed
    if (this.inFlight.has(cacheKey)) return;

    const promise = this.executeAndCache(cacheKey, fetchFn, ttl);
    this.inFlight.set(cacheKey, { promise, startedAt: Date.now() });

    promise
      .then(() => {
        // Update the existing entry's creation time
        const entry = this.cache.get(cacheKey);
        if (entry) {
          entry.isStale = false;
        }
      })
      .catch((err) => {
        logger.debug('Background cache refresh failed', { cacheKey, error: err?.message });
      })
      .finally(() => {
        this.inFlight.delete(cacheKey);
      });
  }

  /**
   * Invalidate cache entries by prefix.
   * E.g., invalidate('reports', { tenantId: 'x' }) removes all report keys for tenant X.
   */
  invalidate(prefix: string, scope?: { tenantId?: string; userId?: string }): void {
    const prefixPattern = `${prefix}`;

    for (const [key] of this.cache) {
      if (key.startsWith(prefixPattern)) {
        if (scope?.tenantId && !key.includes(`t:${scope.tenantId}`)) continue;
        if (scope?.userId && !key.includes(`u:${scope.userId}`)) continue;
        this.cache.delete(key);
      }
    }

    // Also cancel in-flight requests for this prefix
    for (const [key] of this.inFlight) {
      if (key.startsWith(prefixPattern)) {
        this.inFlight.delete(key);
      }
    }

    logger.debug('Cache invalidated', { prefix, scope });
  }

  /**
   * Invalidate ALL entries (use sparingly).
   */
  invalidateAll(): void {
    this.cache.clear();
    this.inFlight.clear();
    logger.warn('Cache fully invalidated');
  }

  /**
   * LRU eviction — remove oldest/least accessed entries.
   */
  private evict(): void {
    if (this.cache.size <= this.config.maxEntries) return;

    const entries = Array.from(this.cache.entries());

    // Sort by lastAccessedAt (oldest first), then by hitCount (lowest first)
    entries.sort(([, a], [, b]) => {
      if (a.lastAccessedAt !== b.lastAccessedAt) {
        return a.lastAccessedAt - b.lastAccessedAt;
      }
      return a.hitCount - b.hitCount;
    });

    const toRemove = entries.slice(0, entries.length - this.config.maxEntries);
    for (const [key] of toRemove) {
      this.cache.delete(key);
    }

    if (toRemove.length > 0) {
      logger.debug('LRU eviction', { evicted: toRemove.length, remaining: this.cache.size });
    }
  }

  /**
   * Get cache stats for monitoring.
   */
  getStats(): {
    entries: number;
    inFlight: number;
    hitRate: number;
    oldestEntryMs: number;
    newestEntryMs: number;
  } {
    const now = Date.now();
    let totalHits = 0;
    let oldest = Infinity;
    let newest = 0;

    for (const [, entry] of this.cache) {
      totalHits += entry.hitCount;
      const age = now - entry.createdAt;
      if (age < oldest) oldest = age;
      if (age > newest) newest = age;
    }

    return {
      entries: this.cache.size,
      inFlight: this.inFlight.size,
      hitRate: this.cache.size > 0 ? totalHits / this.cache.size : 0,
      oldestEntryMs: oldest === Infinity ? 0 : oldest,
      newestEntryMs: newest,
    };
  }
}

// ============================================================
// Factory — Pre-configured caches per domain
// ============================================================

const caches = new Map<string, ResponseCache>();

export function getResponseCache(domain: string, config?: Partial<CacheConfig>): ResponseCache {
  if (!caches.has(domain)) {
    caches.set(domain, new ResponseCache(config));
  }
  return caches.get(domain)!;
}

/**
 * Get health of all caches.
 */
export function getCacheHealth(): Record<string, ReturnType<ResponseCache['getStats']>> {
  const result: Record<string, ReturnType<ResponseCache['getStats']>> = {};
  for (const [domain, cache] of caches) {
    result[domain] = cache.getStats();
  }
  return result;
}

// Auto-log stats
setInterval(() => {
  if (process.env.LOG_CACHE_STATS !== 'true') {
    return;
  }

  const stats = getCacheHealth();
  const activeCaches = Object.entries(stats).filter(([, s]) => s.entries > 0);

  if (activeCaches.length > 0) {
    logger.info('Cache stats', {
      caches: Object.fromEntries(
        activeCaches.map(([domain, s]) => [
          domain,
          { entries: s.entries, inFlight: s.inFlight, hitRate: Math.round(s.hitRate * 100) / 100 },
        ])
      ),
    });
  }
}, 30_000);
