/**
 * Redis Cache Layer — PilingTrack
 *
 * Production-ready Redis caching with:
 * - Connection pooling (ioredis)
 * - Automatic serialization/deserialization
 * - Cache invalidation patterns
 * - Fallback to DB on cache miss
 * - Circuit breaker on Redis failure
 *
 * Usage:
 *   import { cache } from '@/lib/redis-cache';
 *
 *   // Get with fallback
 *   const data = await cache.getOrSet('sites:all', () => db.site.findMany(), { ttl: 300 });
 *
 *   // Manual set/get
 *   await cache.set('user:123', userData, { ttl: 600 });
 *   const user = await cache.get('user:123');
 *
 *   // Invalidate
 *   await cache.invalidate('sites:*');
 *   await cache.invalidatePattern('report:*');
 */

// Guard against client-side imports (Next.js only, not Node.js workers).
// Fire-and-forget so this file compiles to CJS in worker contexts (tsx).
if (typeof window === 'undefined' && process.env.NEXT_RUNTIME !== 'edge') {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment -- @ts-ignore (not -expect-error) is intentional: in worker/CJS builds 'server-only' may be absent (a real TS error), but it's installed under Next.js (no error), so @ts-expect-error would itself fail.
  // @ts-ignore - server-only not available in all contexts
  import('server-only').catch(() => {
    // Ignore: running in worker context where server-only isn't installed
  });
}
import { Redis, RedisOptions } from 'ioredis';
import { redisCircuitBreaker } from '@/core/infrastructure/circuit-breakers';
import { logger } from '@/lib/logger';

// ============================================================
// Configuration
// ============================================================

// Prefer the dedicated cache instance (allkeys-lru). Fall back to
// REDIS_URL (state instance, noeviction) for single-Redis deployments.
const REDIS_URL = process.env.REDIS_URL_CACHE || process.env.REDIS_URL || 'redis://localhost:6379';
const CACHE_DEFAULT_TTL = parseInt(process.env.CACHE_DEFAULT_TTL || '300', 10); // 5 min
const CACHE_MAX_RETRIES = 2;
const CACHE_CONNECT_TIMEOUT = 5000;

function getRedisOptions(): RedisOptions {
  return {
    maxRetriesPerRequest: CACHE_MAX_RETRIES,
    connectTimeout: CACHE_CONNECT_TIMEOUT,
    retryStrategy: (times: number) => {
      if (times > CACHE_MAX_RETRIES) {
        return null; // Stop retrying — circuit breaker handles the rest
      }
      return Math.min(times * 200, 3000); // Exponential backoff
    },
    lazyConnect: true,
    enableOfflineQueue: true,
    keyPrefix: 'pilingtrack:',
  };
}

let redisClient: Redis | null = null;

export async function getRedisClient(): Promise<Redis | null> {
  if (!redisClient) {
    redisClient = new Redis(REDIS_URL, getRedisOptions());

    redisClient.on('error', (err) => {
      logger.error('Redis: connection error', err);
    });

    redisClient.on('connect', () => {
      if (process.env.LOG_REDIS_LIFECYCLE === 'true') {
        logger.info('Redis: connected');
      }
    });

    redisClient.on('ready', () => {
      if (process.env.LOG_REDIS_LIFECYCLE === 'true') {
        logger.info('Redis: ready');
      }
    });

    await redisClient.connect();
  }

  return redisClient;
}

// ============================================================
// Cache API
// ============================================================

export interface CacheOptions {
  ttl?: number; // seconds
  tags?: string[]; // for grouped invalidation
}

/**
 * Serialize value for Redis storage.
 */
function serialize(value: unknown): string {
  return JSON.stringify({
    v: 1, // version for future migrations
    d: value,
    t: Date.now(),
  });
}

/**
 * Deserialize value from Redis storage.
 */
function deserialize<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed.d as T;
  } catch {
    return null; // Corrupted data — treat as miss
  }
}

/**
 * Build cache key with optional tags.
 */
function buildKey(key: string): string {
  return key.replace(/\s+/g, '_').toLowerCase();
}

/**
 * Get a value from cache.
 */
export async function get<T>(key: string): Promise<T | null> {
  const client = await getRedisClient();
  if (!client) return null;

  try {
    return await redisCircuitBreaker.execute(async () => {
      const raw = await client.get(buildKey(key));
      return deserialize<T>(raw);
    });
  } catch {
    return null;
  }
}

/**
 * Set a value in cache with optional TTL.
 */
export async function set(
  key: string,
  value: unknown,
  options?: CacheOptions
): Promise<boolean> {
  const client = await getRedisClient();
  if (!client) return false;

  try {
    return await redisCircuitBreaker.execute(async () => {
      const serialized = serialize(value);
      const ttl = options?.ttl ?? CACHE_DEFAULT_TTL;
      await client.setex(buildKey(key), ttl, serialized);
      return true;
    });
  } catch {
    return false;
  }
}

/**
 * Get from cache, or compute and cache if miss.
 * This is the primary cache pattern: read-through with fallback.
 */
export async function getOrSet<T>(
  key: string,
  compute: () => Promise<T>,
  options?: CacheOptions
): Promise<T> {
  // Try cache first
  const cached = await get<T>(key);
  if (cached !== null) return cached;

  // Cache miss — compute
  const value = await compute();

  // Store in cache (best effort)
  await set(key, value, options);

  return value;
}

/**
 * Delete a single key.
 */
export async function del(key: string): Promise<boolean> {
  const client = await getRedisClient();
  if (!client) return false;

  try {
    await client.del(buildKey(key));
    return true;
  } catch {
    return false;
  }
}

/**
 * Invalidate all keys matching a pattern.
 * Uses SCAN (not KEYS) for production safety.
 *
 * FIX: Properly awaits each batch deletion to prevent:
 * 1. Premature resolve before deletions complete
 * 2. Inaccurate deleted count
 * 3. Race conditions under high key counts
 */
export async function invalidatePattern(pattern: string): Promise<number> {
  const client = await getRedisClient();
  if (!client) return 0;

  let deleted = 0;
  const fullPattern = buildKey(pattern);

  try {
    // Collect all keys first, then delete in batches
    const allKeys: string[][] = [];

    await new Promise<void>((resolve, reject) => {
      const stream = client.scanStream({ match: fullPattern, count: 100 });
      stream.on('data', (keys: string[]) => {
        if (keys.length > 0) {
          allKeys.push(keys);
        }
      });
      stream.on('end', () => resolve());
      stream.on('error', (err) => reject(err));
    });

    // Now delete sequentially — each batch is awaited
    for (const keys of allKeys) {
      await client.del(keys);
      deleted += keys.length;
    }
  } catch (err) {
    logger.warn('Cache: pattern invalidation failed', { error: (err as Error).message });
  }

  return deleted;
}

/**
 * Get cache statistics.
 */
export async function getStats(): Promise<{
  connected: boolean;
  keys: number;
  memory: string;
  circuitOpen: boolean;
} | null> {
  const client = await getRedisClient();
  const circuitOpen = redisCircuitBreaker.getState().state === 'OPEN';
  if (!client) return null;

  try {
    const info = await client.info();
    const dbLine = info.split('\n').find((l) => l.startsWith('db0:'));
    const keys = dbLine ? parseInt(dbLine.split('keys=')[1]?.split(',')[0] || '0', 10) : 0;

    const memoryLine = info.split('\n').find((l) => l.startsWith('used_memory_human:'));
    const memory = memoryLine ? memoryLine.split(':')[1]?.trim() : 'unknown';

    return { connected: true, keys, memory, circuitOpen };
  } catch {
    return { connected: false, keys: 0, memory: 'unknown', circuitOpen };
  }
}

/**
 * Graceful shutdown.
 */
export async function closeRedisConnection(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}

export const cache = {
  get,
  set,
  getOrSet,
  del,
  invalidate: invalidatePattern,
  invalidatePattern,
  getStats,
};
