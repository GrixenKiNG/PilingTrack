/**
 * Redis API Cache — Cache-aside pattern with graceful degradation
 *
 * Usage:
 *   const data = await withCache('sites:all', 60, () => db.site.findMany(...));
 *   await invalidateCache('sites:*');
 */

import Redis from 'ioredis';

let redis: Redis | null = null;

function getRedis(): Redis | null {
  if (redis === undefined) {
    try {
      // Prefer the dedicated cache instance (allkeys-lru). Fall back to
      // REDIS_URL (state instance, noeviction) for single-Redis deployments.
      const url = process.env.REDIS_URL_CACHE || process.env.REDIS_URL;
      if (url) {
        redis = new Redis(url, {
          maxRetriesPerRequest: 2,
          retryStrategy: (times) => (times > 2 ? null : 100),
          lazyConnect: true,
        });
      } else {
        redis = null;
      }
    } catch {
      redis = null;
    }
  }
  return redis;
}

function isAvailable(): boolean {
  return getRedis()?.status === 'ready' || getRedis()?.status === 'connect';
}

export async function withCache<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>
): Promise<T> {
  const client = getRedis();
  if (!isAvailable() || !client) {
    return fetcher(); // graceful degradation
  }

  try {
    const cached = await client.get(key);
    if (cached) {
      return JSON.parse(cached) as T;
    }
  } catch {
    return fetcher();
  }

  const data = await fetcher();

  try {
    await client.set(key, JSON.stringify(data), 'EX', ttlSeconds);
  } catch {
    // Cache miss write — non-fatal
  }

  return data;
}

export async function invalidateCache(pattern: string): Promise<void> {
  const client = getRedis();
  if (!isAvailable() || !client) return;

  try {
    // SCAN + DEL (safe, unlike KEYS which blocks)
    let cursor = 0;
    do {
      const result = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = Number(result[0]);
      const keys = result[1];
      if (keys.length > 0) {
        await client.del(...keys);
      }
    } while (cursor !== 0);
  } catch {
    // Non-fatal
  }
}

export async function warmCache(key: string, ttlSeconds: number, data: unknown): Promise<void> {
  const client = getRedis();
  if (!isAvailable() || !client) return;

  try {
    await client.set(key, JSON.stringify(data), 'EX', ttlSeconds);
  } catch {
    // Non-fatal
  }
}

/**
 * Decorator for GET handlers — wraps response in cache.
 */
export function cachedResponse<T>(
  keyFn: (req: Request) => string,
  ttlSeconds: number
) {
  return async function <R>(
    handler: (req: Request) => Promise<R>,
    req: Request
  ): Promise<R> {
    const key = keyFn(req);
    return withCache(key, ttlSeconds, () => handler(req));
  };
}
