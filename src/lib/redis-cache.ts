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

import { Redis, RedisOptions } from 'ioredis';
import { redisCircuitBreaker } from '@/core/infrastructure/circuit-breakers';
import { logger } from '@/lib/logger';

// ============================================================
// Configuration
// ============================================================

// Prefer the dedicated cache instance (allkeys-lru). Fall back to
// REDIS_URL (state instance, noeviction) for single-Redis deployments.
const REDIS_URL = process.env.REDIS_URL_CACHE || process.env.REDIS_URL || 'redis://localhost:6379';
// Состояние — всегда на noeviction-инстансе, без подмены на кэш.
const STATE_REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const CACHE_DEFAULT_TTL = parseInt(process.env.CACHE_DEFAULT_TTL || '300', 10); // 5 min
const CACHE_MAX_RETRIES = 2;
const CACHE_CONNECT_TIMEOUT = 5000;

function getRedisOptions(): RedisOptions {
  return {
    protocol: 2,
    maxRetriesPerRequest: CACHE_MAX_RETRIES,
    connectTimeout: CACHE_CONNECT_TIMEOUT,
    // Соединение, умершее молча после подключения (NAT сбросил состояние,
    // завис прокси), держало все команды в очереди клиента, пока TCP не оборвёт
    // его — минуты. Таймер включается, только пока команда ждёт ответа, и по
    // истечении рвёт сокет: клиент переподключается, команды получают ответ или
    // ошибку. 10 с — вдвое больше connectTimeout и втрое меньше аренды лидера
    // (30 с); команды здесь короткие (GET/SET/EVAL/SCAN), блокирующих нет.
    // TCP keep-alive у ioredis уже включён (30 с по умолчанию) — не трогаем.
    socketTimeout: 10_000,
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

interface ClientSlot {
  client: Redis | null;
  /** Идущее подключение: все параллельные вызовы ждут его, а не берут клиента до `connect()`. */
  connecting: Promise<Redis | null> | null;
  readonly url: string;
}

const cacheSlot: ClientSlot = { client: null, connecting: null, url: REDIS_URL };
const stateSlot: ClientSlot = { client: null, connecting: null, url: STATE_REDIS_URL };

function getClient(slot: ClientSlot): Promise<Redis | null> {
  if (slot.client) return Promise.resolve(slot.client);
  // Клиент в слот попадает только после успешного connect(). Раньше его клали
  // сразу, и параллельный вызов (лимитер, пульс, лидер outbox) ставил команду в
  // очередь клиента, который тут же отбрасывался по ошибке подключения:
  // disconnect() очередь не очищает, команда не завершалась никогда, а выбор
  // лидера при висящей попытке новых не начинает (F1 стенда 16.10.2026).
  slot.connecting ??= connectClient(slot).finally(() => {
    slot.connecting = null;
  });
  return slot.connecting;
}

async function connectClient(slot: ClientSlot): Promise<Redis | null> {
  const client = new Redis(slot.url, getRedisOptions());

  client.on('error', (err) => {
    logger.error('Redis: connection error', err);
  });

  client.on('connect', () => {
    if (process.env.LOG_REDIS_LIFECYCLE === 'true') {
      logger.info('Redis: connected');
    }
  });

  client.on('ready', () => {
    if (process.env.LOG_REDIS_LIFECYCLE === 'true') {
      logger.info('Redis: ready');
    }
  });

  client.on('end', () => {
    // Terminal close: retryStrategy gave up (returned null). Without this
    // reset the dead client stayed the singleton forever — a brief startup
    // race became permanent degradation until a container restart
    // (audit M1: ~5760 heartbeat/metrics errors per day at green health).
    if (slot.client === client) slot.client = null;
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // connectTimeout ioredis ограничивает только TCP-фазу. Сервер, который принял
    // сокет и молчит на handshake, держал бы общий промис вечно — вместе со
    // всеми, кто его ждёт (кэш, пульс, лидер outbox; рецензия N17-22).
    await Promise.race([
      client.connect(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Redis handshake timed out')),
          CACHE_CONNECT_TIMEOUT * 2,
        );
      }),
    ]);
  } catch (err) {
    logger.error('Redis: initial connect failed', err instanceof Error ? err : new Error(String(err)));
    client.disconnect();
    return null;
  } finally {
    clearTimeout(timer);
  }

  slot.client = client;
  return client;
}

export async function getRedisClient(): Promise<Redis | null> {
  return getClient(cacheSlot);
}

/**
 * Клиент к инстансу состояния (REDIS_URL, noeviction) — без подмены на кэш.
 *
 * Разведено с `getRedisClient`, потому что тот предпочитает REDIS_URL_CACHE, а
 * эта переменная задана не во всех контейнерах. На проде это расщепило пульс
 * служб: ws и workers (без REDIS_URL_CACHE) писали его в инстанс состояния, а
 * app (с REDIS_URL_CACHE) искал в кэше — и не находил. `/api/health/deep`
 * отдавал 503 при живом ws-сервере (проверено 22.09.2026: upgrade отвечал 101).
 *
 * Пульс — состояние, а не кэш: вытесненная запись читается как «служба мертва».
 * Тот же довод, что у списка отозванных токенов в services/auth/session-service.
 *
 * Отдельного кэш-инстанса нет — это тот же сервер, второе соединение не нужно.
 */
export async function getStateRedisClient(): Promise<Redis | null> {
  if (!process.env.REDIS_URL_CACHE) return getClient(cacheSlot);
  return getClient(stateSlot);
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
  const prefix = client.options.keyPrefix ?? '';
  // SCAN matches physical keys; ioredis only prefixes key arguments (DEL).
  const fullPattern = prefix + buildKey(pattern);

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
      deleted += await client.del(...keys.map((key) => key.slice(prefix.length)));
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
  for (const slot of [cacheSlot, stateSlot]) {
    if (!slot.client) continue;
    await slot.client.quit();
    slot.client = null;
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
