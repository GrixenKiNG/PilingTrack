import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {AUTH_RATE_LIMIT, rateLimiter} from '../rate-limiter';

/**
 * Путь через Redis. Основной тест лимитера гоняет память; здесь в синглтон
 * подставлен поддельный клиент, чтобы проверить то, что на бою работает
 * всегда: Lua-сценарий, запасной EVAL, чтение статуса и откат на память при
 * сбое Redis. Сбой Redis не должен открывать ворота перебору паролей.
 */
function fakeRedis() {
  return {
    evalsha: vi.fn(),
    eval: vi.fn(),
    del: vi.fn().mockResolvedValue(2),
    mget: vi.fn(),
    quit: vi.fn().mockResolvedValue('OK'),
  };
}

const internals = rateLimiter as unknown as {
  redis: unknown; redisReady: boolean; luaSha: string;
};

describe('rate-limiter через Redis', () => {
  let redis: ReturnType<typeof fakeRedis>;

  beforeEach(() => {
    vi.stubEnv('RATE_LIMIT_BYPASS', '');
    redis = fakeRedis();
    internals.redis = redis;
    internals.redisReady = true;
    internals.luaSha = 'sha-1';
    rateLimiter.clearAll();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    internals.redis = null;
    internals.redisReady = false;
    rateLimiter.clearAll();
  });

  it('isRedisAvailable отвечает true только при готовом клиенте', () => {
    expect(rateLimiter.isRedisAvailable()).toBe(true);
    internals.redisReady = false;
    expect(rateLimiter.isRedisAvailable()).toBe(false);
  });

  it('разрешённая попытка: счёт и остаток приходят из сценария', async () => {
    redis.evalsha.mockResolvedValue([0, 3, 0]);
    const result = await rateLimiter.check('login:a', AUTH_RATE_LIMIT);
    expect(result).toEqual({allowed: true, remaining: 3});
    expect(redis.evalsha).toHaveBeenCalledWith('sha-1', 2, 'rl:login:a', 'rl:blocked:login:a',
      String(AUTH_RATE_LIMIT.maxAttempts), String(AUTH_RATE_LIMIT.windowMs),
      String(AUTH_RATE_LIMIT.blockDurationMs), expect.any(String));
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it('блокировка: срок ожидания считается от времени разблокировки', async () => {
    const until = Date.now() + 90_000;
    redis.evalsha.mockResolvedValue([1, 0, until]);
    const result = await rateLimiter.check('login:a', AUTH_RATE_LIMIT);
    expect(result).toMatchObject({allowed: false, remaining: 0, blockedUntil: until});
    expect(result.retryAfter).toBeGreaterThanOrEqual(89);
    expect(result.retryAfter).toBeLessThanOrEqual(90);
  });

  it('если сценарий не закэширован, повторяет через EVAL', async () => {
    redis.evalsha.mockRejectedValue(new Error('NOSCRIPT'));
    redis.eval.mockResolvedValue([0, 4, 0]);
    expect(await rateLimiter.check('login:b', AUTH_RATE_LIMIT)).toEqual({allowed: true, remaining: 4});
    expect(redis.eval).toHaveBeenCalledOnce();
  });

  it('сбой Redis не открывает ворота: счёт продолжается в памяти и Redis отключается', async () => {
    redis.evalsha.mockRejectedValue(new Error('down'));
    redis.eval.mockRejectedValue(new Error('down'));
    const config = {maxAttempts: 2, windowMs: 60_000, blockDurationMs: 60_000};
    expect((await rateLimiter.check('login:c', config)).allowed).toBe(true);
    expect(rateLimiter.isRedisAvailable()).toBe(false);
    expect((await rateLimiter.check('login:c', config)).allowed).toBe(true);
    expect((await rateLimiter.check('login:c', config)).allowed).toBe(false);
  });

  it('reset снимает оба ключа в Redis', async () => {
    await rateLimiter.reset('login:a');
    expect(redis.del).toHaveBeenCalledWith('rl:login:a', 'rl:blocked:login:a');
  });

  it('reset при сбое Redis чистит память и отключает Redis', async () => {
    redis.del.mockRejectedValue(new Error('down'));
    await rateLimiter.reset('login:a');
    expect(rateLimiter.isRedisAvailable()).toBe(false);
  });

  it('getStatus читает счётчик и срок блокировки', async () => {
    const until = Date.now() + 60_000;
    redis.mget.mockResolvedValue(['4', String(until)]);
    expect(await rateLimiter.getStatus('login:a')).toEqual({attempts: 4, blocked: true, blockedUntil: until});
    redis.mget.mockResolvedValue(['2', null]);
    expect(await rateLimiter.getStatus('login:a')).toEqual({attempts: 2, blocked: false});
    redis.mget.mockResolvedValue([null, String(Date.now() - 1000)]);
    expect(await rateLimiter.getStatus('login:a')).toEqual({attempts: 0, blocked: false});
  });

  it('getStatus при сбое Redis отвечает из памяти', async () => {
    redis.mget.mockRejectedValue(new Error('down'));
    expect(await rateLimiter.getStatus('login:zz')).toEqual({attempts: 0, blocked: false, blockedUntil: undefined});
    expect(rateLimiter.isRedisAvailable()).toBe(false);
  });

  it('getStats сообщает, что Redis доступен', async () => {
    expect(await rateLimiter.getStats()).toMatchObject({redisAvailable: true});
  });

  it('shutdown закрывает соединение и больше его не использует', async () => {
    await rateLimiter.shutdown();
    expect(redis.quit).toHaveBeenCalledOnce();
    expect(rateLimiter.isRedisAvailable()).toBe(false);
    await expect(rateLimiter.shutdown()).resolves.toBeUndefined();
  });
});

describe('rate-limiter: запуск и уборка', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    vi.doUnmock('ioredis');
    vi.unstubAllEnvs();
  });

  it('без REDIS_URL работает в памяти и не создаёт клиента', async () => {
    vi.stubEnv('REDIS_URL', '');
    vi.resetModules();
    const mod = await import('../rate-limiter');
    expect(mod.rateLimiter.isRedisAvailable()).toBe(false);
  });

  it('при REDIS_URL подключается, загружает сценарий и становится доступным', async () => {
    const created: Array<{handlers: Record<string, (arg?: unknown) => void>}> = [];
    const connect = vi.fn().mockResolvedValue(undefined);
    const script = vi.fn().mockResolvedValue('sha-loaded');
    vi.doMock('ioredis', () => ({default: class {
      handlers: Record<string, (arg?: unknown) => void> = {};
      constructor() { created.push(this); }
      on(event: string, handler: (arg?: unknown) => void) { this.handlers[event] = handler; return this; }
      connect = connect;
      script = script;
    }}));
    vi.stubEnv('REDIS_URL', 'redis://127.0.0.1:6379');
    vi.stubEnv('LOG_REDIS_LIFECYCLE', 'true');
    vi.resetModules();
    const mod = await import('../rate-limiter');
    await vi.waitFor(() => expect(mod.rateLimiter.isRedisAvailable()).toBe(true));
    expect(script).toHaveBeenCalledWith('LOAD', expect.stringContaining('redis.call'));
    created[0].handlers.error({message: 'boom'});
    expect(mod.rateLimiter.isRedisAvailable()).toBe(false);
    created[0].handlers.ready();
    expect(mod.rateLimiter.isRedisAvailable()).toBe(true);
  });

  it('если подключиться не удалось, остаётся память', async () => {
    vi.doMock('ioredis', () => ({default: class {
      on() { return this; }
      connect = vi.fn().mockRejectedValue(new Error('refused'));
    }}));
    vi.stubEnv('REDIS_URL', 'redis://127.0.0.1:6379');
    vi.resetModules();
    const mod = await import('../rate-limiter');
    await vi.waitFor(() => expect((mod.rateLimiter as unknown as {redis: unknown}).redis).toBeNull());
    expect(mod.rateLimiter.isRedisAvailable()).toBe(false);
    expect((await mod.rateLimiter.check('x', {maxAttempts: 1, windowMs: 1000, blockDurationMs: 1000})).allowed).toBe(true);
  });

  it('периодическая уборка снимает истёкшие окна и блокировки', async () => {
    vi.useFakeTimers();
    vi.stubEnv('REDIS_URL', '');
    vi.resetModules();
    const mod = await import('../rate-limiter');
    const config = {maxAttempts: 1, windowMs: 1000, blockDurationMs: 1000};
    await mod.rateLimiter.check('old', config);
    await mod.rateLimiter.check('blocked', config);
    await mod.rateLimiter.check('blocked', config); // превысили — блок
    expect((await mod.rateLimiter.getStats()).totalEntries).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(66 * 60 * 1000);
    expect(await mod.rateLimiter.getStats()).toMatchObject({activeIdentifiers: 0, blockedIdentifiers: 0, totalEntries: 0});
  });
});
