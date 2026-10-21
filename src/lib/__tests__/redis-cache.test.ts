import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Поведение кэша Redis: запись/чтение, срок жизни ключа, промах, недоступный
 * Redis (кэш не должен ронять запрос) и ключи по организациям. Подменён только
 * ioredis — логика кэша (buildKey, сериализация, TTL по умолчанию, обход отказа,
 * SCAN при сбросе по шаблону) настоящая.
 */
const fake = vi.hoisted(() => {
  interface Entry {
    value: string;
    expiresAt: number;
  }

  const state = {
    /** Физические ключи, как их видит Redis (с keyPrefix). */
    store: new Map<string, Entry>(),
    setex: [] as Array<{ key: string; ttl: number }>,
    /** Сдвиг часов поддельного Redis — для проверки истечения TTL. */
    clockShiftMs: 0,
    connectFails: false,
    created: 0,
  };

  const now = () => Date.now() + state.clockShiftMs;

  const readLive = (physical: string): string | null => {
    const entry = state.store.get(physical);
    if (!entry) return null;
    if (now() >= entry.expiresAt) {
      state.store.delete(physical);
      return null;
    }
    return entry.value;
  };

  const globToRegExp = (pattern: string) =>
    new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);

  class FakeRedis {
    readonly options: { keyPrefix?: string };
    handlers: Record<string, (arg?: unknown) => void> = {};

    constructor(readonly url: string, options: { keyPrefix?: string } = {}) {
      this.options = options;
      state.created += 1;
    }

    private physical(key: string): string {
      return `${this.options.keyPrefix ?? ''}${key}`;
    }

    on(event: string, handler: (arg?: unknown) => void): this {
      this.handlers[event] = handler;
      return this;
    }

    async connect(): Promise<this> {
      if (state.connectFails) throw new Error('connect refused');
      return this;
    }

    async get(key: string): Promise<string | null> {
      return readLive(this.physical(key));
    }

    async setex(key: string, ttl: number, value: string): Promise<'OK'> {
      state.setex.push({ key: this.physical(key), ttl });
      state.store.set(this.physical(key), { value, expiresAt: now() + ttl * 1000 });
      return 'OK';
    }

    async del(...keys: string[]): Promise<number> {
      let deleted = 0;
      for (const key of keys) {
        if (state.store.delete(this.physical(key))) deleted += 1;
      }
      return deleted;
    }

    /** Как у ioredis: MATCH — физический шаблон, префикс в него не подставляется. */
    scanStream({ match }: { match: string; count?: number }): EventEmitter {
      const emitter = new EventEmitter();
      const matcher = globToRegExp(match);
      const matched = [...state.store.keys()].filter((key) => matcher.test(key));
      setImmediate(() => {
        if (matched.length > 0) emitter.emit('data', matched);
        emitter.emit('end');
      });
      return emitter;
    }

    async info(): Promise<string> {
      return 'db0:keys=0,expires=0\nused_memory_human:1M';
    }

    async quit(): Promise<'OK'> {
      return 'OK';
    }

    disconnect(): void {}
  }

  const reset = () => {
    state.store.clear();
    state.setex.length = 0;
    state.clockShiftMs = 0;
    state.connectFails = false;
    state.created = 0;
  };

  return { state, FakeRedis, reset };
});

vi.mock('ioredis', () => ({ Redis: fake.FakeRedis, default: fake.FakeRedis }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

async function load() {
  vi.resetModules();
  return import('../redis-cache');
}

describe('кэш Redis', () => {
  beforeEach(() => {
    fake.reset();
  });

  it('записывает и читает значение', async () => {
    const { cache } = await load();
    const payload = { id: 'p1', name: 'Свая СВ 300-80', meters: 12.5, tags: ['alpha'] };

    expect(await cache.set('crews:all', payload)).toBe(true);
    expect(await cache.get('crews:all')).toEqual(payload);
  });

  it('срок жизни: по умолчанию 300 с, явный ttl переопределяет, истёкший ключ — промах', async () => {
    const { cache } = await load();

    await cache.set('crews:all', [1]);
    await cache.set('dictionary:orion:all', [2], { ttl: 60 });

    // Истечение выполняет Redis, поэтому проверяем переданный ему срок.
    expect(fake.state.setex.map((call) => call.ttl)).toEqual([300, 60]);

    fake.state.clockShiftMs = 61_000;
    expect(await cache.get('dictionary:orion:all')).toBeNull();
    expect(await cache.get('crews:all')).toEqual([1]);
  });

  it('отсутствующий ключ — промах: get → null, getOrSet считает и кладёт в кэш', async () => {
    const { cache } = await load();
    const compute = vi.fn(async () => [{ id: 's1' }]);

    expect(await cache.get('sites:all')).toBeNull();
    expect(await cache.getOrSet('sites:all', compute)).toEqual([{ id: 's1' }]);
    expect(await cache.getOrSet('sites:all', compute)).toEqual([{ id: 's1' }]);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('недоступный Redis не роняет запрос: get → null, set → false, getOrSet считает сам', async () => {
    const { cache } = await load();
    fake.state.connectFails = true;
    const compute = vi.fn(async () => [{ id: 's1' }]);

    expect(await cache.get('crews:all')).toBeNull();
    expect(await cache.set('crews:all', [1])).toBe(false);
    expect(await cache.getOrSet('sites:all', compute)).toEqual([{ id: 's1' }]);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('битое значение в Redis читается как промах, а не падение', async () => {
    const { cache } = await load();
    fake.state.store.set('pilingtrack:crews:all', {
      value: '{"v":1,"d":[1,2',
      expiresAt: Date.now() + 60_000,
    });

    expect(await cache.get('crews:all')).toBeNull();
  });

  it('ключ несёт организацию: данные одной организации не видны другой', async () => {
    const { cache } = await load();
    const grades = { grades: ['СВ 300-80'] };

    await cache.set('dictionary:orion:all', grades);

    expect(await cache.get('dictionary:mkm:all')).toBeNull();
    expect(await cache.get('dictionary:orion:all')).toEqual(grades);
    // Физический ключ: общий префикс приложения + имя организации в ключе.
    expect([...fake.state.store.keys()]).toEqual(['pilingtrack:dictionary:orion:all']);
  });

  it('сброс по шаблону снимает ключи только своей организации', async () => {
    const { cache } = await load();

    await cache.set('analytics:sites:v3:orion:2026-10', { total: 1 });
    await cache.set('analytics:sites:v3:mkm:2026-10', { total: 2 });

    expect(await cache.invalidatePattern('analytics:sites:v3:orion:*')).toBe(1);
    expect(await cache.get('analytics:sites:v3:orion:2026-10')).toBeNull();
    expect(await cache.get('analytics:sites:v3:mkm:2026-10')).toEqual({ total: 2 });
  });

  // дефект: getOrSet пишет в кэш и null, а get считает null промахом
  // (`if (cached !== null)`), поэтому «источник ответил пусто» не кэшируется и
  // каждый запрос снова идёт наружу (AU52-S4-WEATHER, находка 9).
  it.fails('getOrSet не пересчитывает значение, закэшированное как null', async () => {
    const { cache } = await load();
    const compute = vi.fn(async () => null);

    await cache.getOrSet('weather:conditions:msk', compute, { ttl: 900 });
    await cache.getOrSet('weather:conditions:msk', compute, { ttl: 900 });

    expect(compute).toHaveBeenCalledTimes(1);
  });
});
