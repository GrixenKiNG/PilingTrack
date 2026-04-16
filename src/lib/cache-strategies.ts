/**
 * Advanced Cache Strategies — PilingTrack
 *
 * Implements three caching patterns:
 *
 * 1. Cache-Aside (Lazy Loading)
 *    - Read: Check cache → if miss, load from DB → populate cache
 *    - Write: Update DB → delete cache key
 *    - Best for: Read-heavy workloads
 *
 * 2. Write-Through
 *    - Write: Update DB AND cache simultaneously
 *    - Read: Always from cache
 *    - Best for: Write-heavy workloads, data consistency
 *
 * 3. Stale-While-Revalidate (SWR)
 *    - Read: Return stale data immediately, revalidate in background
 *    - Write: Update both DB and cache
 *    - Best for: Low-latency requirements, eventual consistency OK
 *
 * Usage:
 *   import { cacheAside, writeThrough, staleWhileRevalidate } from '@/lib/cache-strategies';
 *
 *   // Cache-aside (most common)
 *   const sites = await cacheAside('sites:all', () => db.site.findMany(), { ttl: 300 });
 *
 *   // Write-through (for mutations)
 *   await writeThrough('sites:all', updatedSites, () => updateSitesInDb(updatedSites), { ttl: 300 });
 *
 *   // Stale-while-revalidate (low latency)
 *   const reports = await staleWhileRevalidate('reports:my', () => fetchReports(), {
 *     ttl: 120,
 *     staleTtl: 3600,
 *     revalidate: () => fetchReports()
 *   });
 */

import { get, set, del, getRedisClient } from './redis-cache';

// ============================================================
// Types
// ============================================================

export interface CacheOptions {
  ttl: number;           // Cache TTL in seconds
  staleTtl?: number;     // Stale data TTL (for SWR)
  tags?: string[];       // For grouped invalidation
  mutex?: boolean;       // Use mutex for stampede prevention
  mutexTtl?: number;     // Mutex TTL in seconds
}

export interface CacheStats {
  hits: number;
  misses: number;
  staleHits: number;
  stampedes: number;
  writes: number;
  deletions: number;
}

// ============================================================
// Global Stats
// ============================================================

export let cacheStats: CacheStats = {
  hits: 0,
  misses: 0,
  staleHits: 0,
  stampedes: 0,
  writes: 0,
  deletions: 0,
};

export function getCacheStats(): CacheStats {
  return { ...cacheStats };
}

export function resetCacheStats(): void {
  cacheStats = { hits: 0, misses: 0, staleHits: 0, stampedes: 0, writes: 0, deletions: 0 };
}

// ============================================================
// 1. Cache-Aside (Lazy Loading)
// ============================================================

/**
 * Cache-Aside pattern.
 *
 * Flow:
 * 1. Try cache.get(key)
 * 2. If hit → return cached value
 * 3. If miss → compute (DB call) → set cache → return
 * 4. On write → update DB → delete cache key (invalidate)
 *
 * With optional mutex to prevent stampede:
 * - First miss acquires a lock (SETNX)
 * - Others wait and retry
 */

export async function cacheAside<T>(
  key: string,
  compute: () => Promise<T>,
  options?: CacheOptions
): Promise<T> {
  const ttl = options?.ttl ?? 300;

  // Try cache first
  const cached = await get<T>(key);
  if (cached !== null) {
    cacheStats.hits++;
    return cached;
  }

  // Cache miss — check for mutex (stampede prevention)
  let mutexAcquired = false;
  if (options?.mutex) {
    const mutexKey = `mutex:${key}`;
    const mutexTtl = options?.mutexTtl ?? 10;
    const client = await getRedisClient();

    if (client) {
      // Try to acquire lock
      const acquired = await client.set(mutexKey, '1', 'EX', mutexTtl, 'NX');
      if (!acquired) {
        // Another request is computing — wait and retry
        cacheStats.stampedes++;
        await new Promise(r => setTimeout(r, 100));
        const retry = await get<T>(key);
        if (retry !== null) return retry;
        // Still miss — proceed without mutex
      } else {
        mutexAcquired = true;
      }
    }
  }

  // Compute value (DB call)
  cacheStats.misses++;
  try {
    const value = await compute();

    // Store in cache
    await set(key, value, { ttl });

    return value;
  } finally {
    // Release mutex on success OR failure — prevents deadlocks
    if (options?.mutex && mutexAcquired) {
      await del(`mutex:${key}`);
    }
  }
}

/**
 * Invalidate cache-aside entry after mutation.
 */
export async function cacheAsideInvalidate(key: string): Promise<void> {
  await del(key);
  cacheStats.deletions++;
}

// ============================================================
// 2. Write-Through
// ============================================================

/**
 * Write-Through pattern.
 *
 * Flow:
 * 1. Compute new value (update DB)
 * 2. Write to cache simultaneously
 * 3. Subsequent reads hit cache
 *
 * Best for: Write-heavy operations where consistency matters.
 */

export async function writeThrough<T>(
  key: string,
  newValue: T,
  persistToDb: () => Promise<void>,
  options?: CacheOptions
): Promise<T> {
  const ttl = options?.ttl ?? 300;

  // 1. Persist to database
  await persistToDb();

  // 2. Write to cache (simultaneously)
  await set(key, newValue, { ttl });

  cacheStats.writes++;

  return newValue;
}

/**
 * Bulk write-through for multiple keys.
 */
export async function writeThroughBulk(
  entries: Array<{
    key: string;
    value: unknown;
    persist: () => Promise<void>;
  }>,
  options?: CacheOptions
): Promise<void> {
  const ttl = options?.ttl ?? 300;

  // Persist all to DB
  await Promise.all(entries.map(e => e.persist()));

  // Write all to cache
  await Promise.all(entries.map(e => set(e.key, e.value, { ttl })));

  cacheStats.writes += entries.length;
}

// ============================================================
// 3. Stale-While-Revalidate (SWR)
// ============================================================

/**
 * Stale-While-Revalidate pattern.
 *
 * Flow:
 * 1. Try fresh cache (key)
 * 2. If fresh miss → try stale cache (key:stale)
 * 3. Return stale immediately if found
 * 4. Revalidate in background
 *
 * Two TTLs:
 * - ttl: Fresh cache lifetime
 * - staleTtl: How long to keep stale data after expiry
 */

export async function staleWhileRevalidate<T>(
  key: string,
  revalidate: () => Promise<T>,
  options?: CacheOptions
): Promise<T> {
  const ttl = options?.ttl ?? 300;
  const staleTtl = options?.staleTtl ?? ttl * 12; // Default: 12x fresh TTL
  const staleKey = `${key}:stale`;

  // Try fresh cache
  const fresh = await get<T>(key);
  if (fresh !== null) {
    cacheStats.hits++;
    return fresh;
  }

  // Try stale cache
  const stale = await get<T>(staleKey);
  if (stale !== null) {
    cacheStats.staleHits++;

    // Revalidate in background (non-blocking)
    revalidateInBackground(key, staleKey, revalidate, ttl, staleTtl);

    return stale;
  }

  // Both miss — compute synchronously
  cacheStats.misses++;
  const value = await revalidate();

  // Store fresh + stale
  await Promise.all([
    set(key, value, { ttl }),
    set(staleKey, value, { ttl: staleTtl }),
  ]);

  return value;
}

/**
 * Background revalidation for SWR.
 */
async function revalidateInBackground<T>(
  key: string,
  staleKey: string,
  revalidate: () => Promise<T>,
  ttl: number,
  staleTtl: number
): Promise<void> {
  // Use setImmediate for Node.js (non-blocking)
  setImmediate(async () => {
    try {
      const value = await revalidate();
      await Promise.all([
        set(key, value, { ttl }),
        set(staleKey, value, { ttl: staleTtl }),
      ]);
    } catch (err) {
      console.warn('[SWR] Background revalidation failed:', (err as Error).message);
      // Keep stale data — don't delete it
    }
  });
}

// ============================================================
// 4. Cache Manager (Unified API)
// ============================================================

export type CacheStrategy = 'cache-aside' | 'write-through' | 'stale-while-revalidate';

export interface CacheManagerOptions {
  defaultStrategy: CacheStrategy;
  defaultTtl: number;
  staleTtl?: number;
  stampedeProtection: boolean;
}

const DEFAULT_MANAGER_OPTIONS: CacheManagerOptions = {
  defaultStrategy: 'cache-aside',
  defaultTtl: 300,
  staleTtl: 3600,
  stampedeProtection: true,
};

export class CacheManager {
  private options: CacheManagerOptions;

  constructor(options?: Partial<CacheManagerOptions>) {
    this.options = { ...DEFAULT_MANAGER_OPTIONS, ...options };
  }

  /**
   * Read from cache using configured strategy.
   */
  async get<T>(
    key: string,
    compute: () => Promise<T>,
    options?: Partial<CacheOptions>
  ): Promise<T> {
    const opts = { ttl: this.options.defaultTtl, ...options };

    switch (this.options.defaultStrategy) {
      case 'cache-aside':
        return cacheAside(key, compute, {
          ...opts,
          mutex: this.options.stampedeProtection,
        });

      case 'stale-while-revalidate':
        return staleWhileRevalidate(key, compute, {
          ...opts,
          staleTtl: this.options.staleTtl,
        });

      default:
        // Fallback to cache-aside
        return cacheAside(key, compute, opts);
    }
  }

  /**
   * Write to cache using write-through.
   */
  async set<T>(
    key: string,
    value: T,
    persistToDb: () => Promise<void>,
    options?: Partial<CacheOptions>
  ): Promise<T> {
    return writeThrough(key, value, persistToDb, {
      ttl: this.options.defaultTtl,
      ...options,
    });
  }

  /**
   * Invalidate cache entry.
   */
  async invalidate(key: string): Promise<void> {
    await Promise.all([
      del(key),
      del(`${key}:stale`),
      del(`mutex:${key}`),
    ]);
    cacheStats.deletions++;
  }

  /**
   * Get cache statistics.
   */
  getStats(): CacheStats & { strategy: string; hitRate: number } {
    const total = cacheStats.hits + cacheStats.misses;
    return {
      ...cacheStats,
      strategy: this.options.defaultStrategy,
      hitRate: total > 0 ? cacheStats.hits / total : 0,
    };
  }
}

// ============================================================
// Pre-configured instances
// ============================================================

/**
 * Default cache manager — cache-aside with stampede protection.
 * Recommended for most use cases.
 */
export const defaultCache = new CacheManager({
  defaultStrategy: 'cache-aside',
  defaultTtl: 300,
  stampedeProtection: true,
});

/**
 * Low-latency cache manager — SWR for latency-sensitive endpoints.
 */
export const lowLatencyCache = new CacheManager({
  defaultStrategy: 'stale-while-revalidate',
  defaultTtl: 60,
  staleTtl: 1800,
  stampedeProtection: true,
});

/**
 * Consistency-focused cache manager — write-through.
 * Use for admin/mutation endpoints.
 */
export const consistentCache = new CacheManager({
  defaultStrategy: 'write-through',
  defaultTtl: 300,
  stampedeProtection: false,
});
