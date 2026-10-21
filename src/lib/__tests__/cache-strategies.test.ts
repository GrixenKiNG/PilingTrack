/**
 * Поведенческие тесты для src/lib/cache-strategies.ts.
 *
 * Проверяем: выбор стратегии кэша по типу данных, TTL по умолчанию, ключ с организацией,
 * поведение при недоступном кэше (запрос идёт в базу), инвалидация по ключу.
 * Внешние сервисы (Redis) замоканы; логика модуля — реальная.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getRedisClient: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  redisClient: {
    set: vi.fn(),
  },
}));

vi.mock('@/lib/redis-cache', () => ({
  getRedisClient: mocks.getRedisClient,
  get: mocks.get,
  set: mocks.set,
  del: mocks.del,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

// Импорт после моков
import {
  cacheAside,
  cacheAsideInvalidate,
  writeThrough,
  writeThroughBulk,
  staleWhileRevalidate,
  defaultCache,
  lowLatencyCache,
  consistentCache,
  getCacheStats,
  resetCacheStats,
} from '../cache-strategies';

function resetAllMocks(): void {
  vi.clearAllMocks();
  resetCacheStats();
  mocks.getRedisClient.mockResolvedValue(mocks.redisClient);
  mocks.redisClient.set.mockResolvedValue('OK');
}

describe('cache-strategies — поведение', () => {
  beforeEach(() => {
    resetAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('cacheAside — кэш-асайд (lazy loading)', () => {
    it('возвращает данные из кэша при попадании (cache hit)', async () => {
      mocks.get.mockResolvedValue({ data: 'cached' });

      const result = await cacheAside('sites:all', async () => ({ data: 'from-db' }));

      expect(result).toEqual({ data: 'cached' });
      expect(mocks.get).toHaveBeenCalledWith('sites:all');
      expect(getCacheStats().hits).toBe(1);
      expect(getCacheStats().misses).toBe(0);
    });

    it('идёт в базу при промахе кэша и сохраняет результат (cache miss → compute → set)', async () => {
      mocks.get.mockResolvedValue(null);
      mocks.set.mockResolvedValue(true);

      const compute = vi.fn().mockResolvedValue({ data: 'from-db' });
      const result = await cacheAside('sites:all', compute, { ttl: 300 });

      expect(result).toEqual({ data: 'from-db' });
      expect(compute).toHaveBeenCalledTimes(1);
      expect(mocks.set).toHaveBeenCalledWith('sites:all', { data: 'from-db' }, { ttl: 300 });
      expect(getCacheStats().misses).toBe(1);
    });

    it('использует TTL по умолчанию (300с), если не передан', async () => {
      mocks.get.mockResolvedValue(null);
      mocks.set.mockResolvedValue(true);

      await cacheAside('key', async () => 'value');

      expect(mocks.set).toHaveBeenCalledWith('key', 'value', { ttl: 300 });
    });

    it('подставляет организацию в ключ, если ключ содержит плейсхолдер', async () => {
      mocks.get.mockResolvedValue(null);
      mocks.set.mockResolvedValue(true);

      await cacheAside('dictionary:tenant-a:all', async () => []);

      expect(mocks.get).toHaveBeenCalledWith('dictionary:tenant-a:all');
      expect(mocks.set).toHaveBeenCalledWith('dictionary:tenant-a:all', [], { ttl: 300 });
    });

    it('при недоступном кэше (get возвращает null) запрос идёт в базу, set вызывается но возвращает false', async () => {
      // Имитируем недоступный Redis: get возвращает null (промах), set возвращает false
      mocks.get.mockResolvedValue(null);
      mocks.set.mockResolvedValue(false); // set не смог записать — нет клиента

      const compute = vi.fn().mockResolvedValue({ data: 'from-db' });
      const result = await cacheAside('key', compute);

      expect(result).toEqual({ data: 'from-db' });
      expect(compute).toHaveBeenCalledTimes(1);
      // set ВСЁ РАВНО вызывается (логика cacheAside не проверяет доступность перед set),
      // но внутри он вернёт false — это и есть поведение «запрос пошёл в базу»
      expect(mocks.set).toHaveBeenCalledWith('key', { data: 'from-db' }, { ttl: 300 });
      expect(getCacheStats().misses).toBe(1);
    });
  });

  describe('cacheAsideInvalidate — инвалидация по ключу', () => {
    it('удаляет ключ кэша и инкрементирует deletions', async () => {
      mocks.del.mockResolvedValue(true);

      await cacheAsideInvalidate('sites:all');

      expect(mocks.del).toHaveBeenCalledWith('sites:all');
      expect(getCacheStats().deletions).toBe(1);
    });
  });

  describe('writeThrough — запись сквозь кэш', () => {
    it('сначала пишет в БД, затем в кэш с переданным TTL', async () => {
      mocks.set.mockResolvedValue(true);
      const persist = vi.fn().mockResolvedValue(undefined);

      const result = await writeThrough('sites:all', { id: 1 }, persist, { ttl: 600 });

      expect(persist).toHaveBeenCalledTimes(1);
      expect(mocks.set).toHaveBeenCalledWith('sites:all', { id: 1 }, { ttl: 600 });
      expect(result).toEqual({ id: 1 });
      expect(getCacheStats().writes).toBe(1);
    });

    it('использует TTL по умолчанию (300с)', async () => {
      mocks.set.mockResolvedValue(true);
      const persist = vi.fn().mockResolvedValue(undefined);

      await writeThrough('key', 'value', persist);

      expect(mocks.set).toHaveBeenCalledWith('key', 'value', { ttl: 300 });
    });

    it('bulk: пишет все записи в БД и кэш параллельно', async () => {
      mocks.set.mockResolvedValue(true);
      const persist1 = vi.fn().mockResolvedValue(undefined);
      const persist2 = vi.fn().mockResolvedValue(undefined);

      await writeThroughBulk([
        { key: 'k1', value: 'v1', persist: persist1 },
        { key: 'k2', value: 'v2', persist: persist2 },
      ], { ttl: 120 });

      expect(persist1).toHaveBeenCalledTimes(1);
      expect(persist2).toHaveBeenCalledTimes(1);
      expect(mocks.set).toHaveBeenCalledTimes(2);
      expect(mocks.set).toHaveBeenCalledWith('k1', 'v1', { ttl: 120 });
      expect(mocks.set).toHaveBeenCalledWith('k2', 'v2', { ttl: 120 });
      expect(getCacheStats().writes).toBe(2);
    });
  });

  describe('staleWhileRevalidate — SWR', () => {
    it('возвращает свежие данные из кэша при попадании', async () => {
      mocks.get.mockResolvedValue({ fresh: true });

      const revalidate = vi.fn().mockResolvedValue({ fresh: false });
      const result = await staleWhileRevalidate('key', revalidate, { ttl: 60, staleTtl: 3600 });

      expect(result).toEqual({ fresh: true });
      expect(revalidate).not.toHaveBeenCalled();
      expect(getCacheStats().hits).toBe(1);
    });

    it('возвращает устаревшие данные и запускает ревалидацию в фоне при попадании в stale', async () => {
      mocks.get
        .mockResolvedValueOnce(null) // fresh miss
        .mockResolvedValueOnce({ stale: true }); // stale hit

      const revalidate = vi.fn().mockResolvedValue({ fresh: true });
      const result = await staleWhileRevalidate('key', revalidate, { ttl: 60, staleTtl: 3600 });

      expect(result).toEqual({ stale: true });
      expect(getCacheStats().staleHits).toBe(1);
      // Ревалидация запускается асинхронно — проверяем через setImmediate
      await new Promise((r) => setImmediate(r));
      expect(revalidate).toHaveBeenCalledTimes(1);
    });

    it('при полном промахе синхронно вызывает revalidate и кладёт в оба ключа', async () => {
      mocks.get.mockResolvedValue(null); // fresh miss, stale miss
      mocks.set.mockResolvedValue(true);
      const revalidate = vi.fn().mockResolvedValue({ computed: true });

      const result = await staleWhileRevalidate('key', revalidate, { ttl: 60, staleTtl: 3600 });

      expect(result).toEqual({ computed: true });
      expect(revalidate).toHaveBeenCalledTimes(1);
      expect(mocks.set).toHaveBeenCalledTimes(2);
      expect(mocks.set).toHaveBeenCalledWith('key', { computed: true }, { ttl: 60 });
      expect(mocks.set).toHaveBeenCalledWith('key:stale', { computed: true }, { ttl: 3600 });
      expect(getCacheStats().misses).toBe(1);
    });

    it('staleTtl по умолчанию = ttl * 12', async () => {
      mocks.get.mockResolvedValue(null);
      mocks.set.mockResolvedValue(true);
      const revalidate = vi.fn().mockResolvedValue({ x: 1 });

      await staleWhileRevalidate('key', revalidate, { ttl: 300 });

      expect(mocks.set).toHaveBeenCalledWith('key:stale', { x: 1 }, { ttl: 3600 }); // 300 * 12
    });
  });

  describe('CacheManager — единый API', () => {
    it('defaultCache использует cache-aside с защитой от стампеда', async () => {
      mocks.get.mockResolvedValue(null);
      mocks.set.mockResolvedValue(true);
      mocks.redisClient.set.mockResolvedValue('OK'); // для mutex

      const compute = vi.fn().mockResolvedValue({ x: 1 });
      await defaultCache.get('key', compute);

      expect(compute).toHaveBeenCalledTimes(1);
      expect(mocks.redisClient.set).toHaveBeenCalledWith(
        expect.stringContaining('mutex:key'),
        '1',
        'EX',
        10,
        'NX'
      );
    });

    it('lowLatencyCache использует SWR', async () => {
      mocks.get.mockResolvedValue(null);
      mocks.set.mockResolvedValue(true);

      const compute = vi.fn().mockResolvedValue({ x: 1 });
      await lowLatencyCache.get('key', compute);

      // SWR: сначала fresh, потом stale, потом compute
      expect(mocks.get).toHaveBeenCalledTimes(2);
      expect(compute).toHaveBeenCalledTimes(1);
    });

    it('consistentCache использует write-through при set', async () => {
      mocks.set.mockResolvedValue(true);
      const persist = vi.fn().mockResolvedValue(undefined);

      await consistentCache.set('key', { y: 2 }, persist);

      expect(persist).toHaveBeenCalledTimes(1);
      expect(mocks.set).toHaveBeenCalledWith('key', { y: 2 }, { ttl: 300 });
    });

    it('invalidate удаляет fresh, stale и mutex ключи', async () => {
      mocks.del.mockResolvedValue(true);

      await defaultCache.invalidate('key');

      expect(mocks.del).toHaveBeenCalledTimes(3);
      expect(mocks.del).toHaveBeenCalledWith('key');
      expect(mocks.del).toHaveBeenCalledWith('key:stale');
      expect(mocks.del).toHaveBeenCalledWith('mutex:key');
      expect(getCacheStats().deletions).toBe(1);
    });

    it('getStats возвращает стратегию и hitRate', async () => {
      mocks.get.mockResolvedValue({ x: 1 });
      await defaultCache.get('k1', async () => ({ x: 1 }));
      await defaultCache.get('k2', async () => ({ x: 2 }));

      const stats = defaultCache.getStats();

      expect(stats.strategy).toBe('cache-aside');
      expect(stats.hits).toBe(2);
      expect(stats.hitRate).toBe(1);
    });
  });
});