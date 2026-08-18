import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  rateLimiter,
  AUTH_RATE_LIMIT,
  PIN_RATE_LIMIT,
  getRateLimitIdentifier,
  getTenantRateLimitIdentifier,
  createRateLimitMiddleware,
} from '../rate-limiter';

describe('rate-limiter', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    // Force in-memory mode — disable Redis completely
    rateLimiter['redisReady'] = false;
    rateLimiter['redis'] = null;
    // Reset the singleton's internal state completely
    rateLimiter.clearAll();
  });

  afterEach(() => {
    vi.useRealTimers();
    // Reset again after each test
    rateLimiter.clearAll();
  });

  describe('check', () => {
    it('allows first request', async () => {
      const result = await rateLimiter.check('user-1', AUTH_RATE_LIMIT);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4); // 5 - 1
    });

    it('allows up to maxAttempts', async () => {
      for (let i = 0; i < 5; i++) {
        const result = await rateLimiter.check('user-1', AUTH_RATE_LIMIT);
        expect(result.allowed).toBe(true);
      }
    });

    it('blocks after exceeding maxAttempts', async () => {
      for (let i = 0; i < 5; i++) {
        await rateLimiter.check('user-1', AUTH_RATE_LIMIT);
      }
      const result = await rateLimiter.check('user-1', AUTH_RATE_LIMIT);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfter).toBeDefined();
    });

    it('returns correct remaining count', async () => {
      await rateLimiter.check('user-1', AUTH_RATE_LIMIT);
      await rateLimiter.check('user-1', AUTH_RATE_LIMIT);
      const result = await rateLimiter.check('user-1', AUTH_RATE_LIMIT);
      expect(result.remaining).toBe(2); // 5 - 3
    });

    it('tracks different identifiers separately', async () => {
      await rateLimiter.check('user-1', AUTH_RATE_LIMIT);
      await rateLimiter.check('user-1', AUTH_RATE_LIMIT);

      const result = await rateLimiter.check('user-2', AUTH_RATE_LIMIT);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);
    });
  });

  describe('window expiration', () => {
    it('resets count after window expires', async () => {
      for (let i = 0; i < 5; i++) {
        await rateLimiter.check('user-1', AUTH_RATE_LIMIT);
      }

      // Advance time past window
      vi.advanceTimersByTime(AUTH_RATE_LIMIT.windowMs + 1000);

      const result = await rateLimiter.check('user-1', AUTH_RATE_LIMIT);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);
    });
  });

  describe('block expiration', () => {
    it('unblocks after blockDurationMs', async () => {
      for (let i = 0; i < 6; i++) {
        await rateLimiter.check('user-1', AUTH_RATE_LIMIT);
      }

      const blockedResult = await rateLimiter.check('user-1', AUTH_RATE_LIMIT);
      expect(blockedResult.allowed).toBe(false);

      // Advance past block duration
      vi.advanceTimersByTime(AUTH_RATE_LIMIT.blockDurationMs + 1000);

      const unblockedResult = await rateLimiter.check('user-1', AUTH_RATE_LIMIT);
      expect(unblockedResult.allowed).toBe(true);
    });
  });

  describe('reset', () => {
    it('resets rate limit for identifier', async () => {
      for (let i = 0; i < 5; i++) {
        await rateLimiter.check('user-1', AUTH_RATE_LIMIT);
      }

      await rateLimiter.reset('user-1');

      const result = await rateLimiter.check('user-1', AUTH_RATE_LIMIT);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);
    });

    it('removes block status', async () => {
      for (let i = 0; i < 6; i++) {
        await rateLimiter.check('user-1', AUTH_RATE_LIMIT);
      }

      await rateLimiter.reset('user-1');

      const result = await rateLimiter.check('user-1', AUTH_RATE_LIMIT);
      expect(result.allowed).toBe(true);
    });
  });

  describe('getStatus', () => {
    it('returns current attempts without incrementing', async () => {
      await rateLimiter.check('user-1', AUTH_RATE_LIMIT);
      await rateLimiter.check('user-1', AUTH_RATE_LIMIT);

      const status = await rateLimiter.getStatus('user-1');
      expect(status.attempts).toBe(2);
      expect(status.blocked).toBe(false);

      // Verify count didn't increase
      const status2 = await rateLimiter.getStatus('user-1');
      expect(status2.attempts).toBe(2);
    });

    it('reports blocked status correctly', async () => {
      for (let i = 0; i < 6; i++) {
        await rateLimiter.check('user-1', AUTH_RATE_LIMIT);
      }

      const status = await rateLimiter.getStatus('user-1');
      expect(status.blocked).toBe(true);
      expect(status.blockedUntil).toBeDefined();
    });
  });

  describe('getStats', () => {
    it('returns accurate counts', async () => {
      await rateLimiter.check('user-1', AUTH_RATE_LIMIT);
      await rateLimiter.check('user-2', AUTH_RATE_LIMIT);

      const stats = await rateLimiter.getStats();
      expect(stats.activeIdentifiers).toBe(2);
      expect(stats.blockedIdentifiers).toBe(0);
    });
  });

  describe('PIN_RATE_LIMIT', () => {
    it('has stricter limits', () => {
      expect(PIN_RATE_LIMIT.maxAttempts).toBe(3);
      expect(PIN_RATE_LIMIT.windowMs).toBe(10 * 60 * 1000);
      expect(PIN_RATE_LIMIT.blockDurationMs).toBe(60 * 60 * 1000);
    });

    it('blocks after 3 attempts', async () => {
      for (let i = 0; i < 3; i++) {
        const result = await rateLimiter.check('user-1', PIN_RATE_LIMIT);
        expect(result.allowed).toBe(true);
      }

      const result = await rateLimiter.check('user-1', PIN_RATE_LIMIT);
      expect(result.allowed).toBe(false);
    });
  });

  describe('getRateLimitIdentifier', () => {
    function req(headers: Record<string, string>): Request {
      return new Request('http://localhost/api/auth/pin', { headers });
    }

    // Brute-force amplification guard: the bucket key must never depend on a
    // client-controlled header. An attacker who can vary the value rotates it
    // to mint a fresh bucket per request and defeats the PIN attempt limit —
    // the same class of bug `resolveClientIp` already gates behind TRUST_PROXY.
    it('ignores the untrusted x-tenant-id header when bucketing', () => {
      const a = getRateLimitIdentifier(req({ 'x-tenant-id': 'attacker-1' }));
      const b = getRateLimitIdentifier(req({ 'x-tenant-id': 'attacker-2' }));
      expect(a).toBe(b);
    });
  });
});

/**
 * Пути, снимающие защиту целиком.
 *
 * До 18.08.2026 файл был покрыт на 42.3%: проверялся сам счётчик, но не то,
 * из чего берётся ключ ведра и когда защита выключается. Ошибка здесь не
 * ослабляет перебор, а отменяет его.
 */
describe('rate-limiter — чем выключается защита', () => {
  const req = (headers: Record<string, string>) =>
    new Request('https://orionpiling.ru/api/auth/login', { headers });

  beforeEach(() => {
    rateLimiter['redisReady'] = false;
    rateLimiter['redis'] = null;
    rateLimiter.clearAll();
  });
  afterEach(() => { vi.unstubAllEnvs(); rateLimiter.clearAll(); });

  it('RATE_LIMIT_BYPASS НЕ действует на проде', async () => {
    // Самый опасный переключатель файла. Если бы условие NODE_ENV отвалилось,
    // одна переменная окружения снимала бы защиту от перебора на бою.
    vi.stubEnv('RATE_LIMIT_BYPASS', 'true');
    vi.stubEnv('NODE_ENV', 'production');

    const cfg = { maxAttempts: 2, windowMs: 60_000, blockDurationMs: 60_000 };
    await rateLimiter.check('prod-user', cfg);
    await rateLimiter.check('prod-user', cfg);
    const third = await rateLimiter.check('prod-user', cfg);

    expect(third.allowed).toBe(false);
  });

  it('RATE_LIMIT_BYPASS действует вне прода — иначе прогоны CI требуют чистки Redis', async () => {
    vi.stubEnv('RATE_LIMIT_BYPASS', 'true');
    vi.stubEnv('NODE_ENV', 'test');

    const cfg = { maxAttempts: 1, windowMs: 60_000, blockDurationMs: 60_000 };
    await rateLimiter.check('ci-user', cfg);
    const second = await rateLimiter.check('ci-user', cfg);

    expect(second.allowed).toBe(true);
  });

  it('без TRUST_PROXY заголовок x-forwarded-for игнорируется', async () => {
    // Иначе перебор тривиален: злоумышленник меняет заголовок на каждом
    // запросе и получает новое ведро счётчика на каждую попытку.
    vi.stubEnv('TRUST_PROXY', 'false');

    const a = getRateLimitIdentifier(req({ 'x-forwarded-for': '1.1.1.1' }));
    const b = getRateLimitIdentifier(req({ 'x-forwarded-for': '2.2.2.2' }));

    // Суть: подменный заголовок не создаёт нового ведра.
    expect(a).toBe(b);
    expect(a).not.toContain('1.1.1.1');
    expect(a).not.toContain('2.2.2.2');
    expect(a.startsWith('host-')).toBe(true);
  });

  it('с TRUST_PROXY берётся первый узел цепочки x-forwarded-for', async () => {
    vi.stubEnv('TRUST_PROXY', 'true');

    const id = getRateLimitIdentifier(req({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }));

    expect(id).toBe('203.0.113.9');
  });

  it('с TRUST_PROXY x-real-ip используется, когда x-forwarded-for нет', async () => {
    vi.stubEnv('TRUST_PROXY', 'true');

    expect(getRateLimitIdentifier(req({ 'x-real-ip': '203.0.113.10' }))).toBe('203.0.113.10');
  });

  it('тенантный ключ всегда содержит адрес — одним заголовком вёдра не наплодить', async () => {
    vi.stubEnv('TRUST_PROXY', 'true');

    const a = getTenantRateLimitIdentifier(req({ 'x-tenant-id': 'a', 'x-forwarded-for': '203.0.113.9' }));
    const b = getTenantRateLimitIdentifier(req({ 'x-tenant-id': 'b', 'x-forwarded-for': '203.0.113.9' }));

    expect(a).toContain('203.0.113.9');
    expect(b).toContain('203.0.113.9');
    expect(a).not.toBe(b); // тенанты всё же разделены
  });

  it('без тенанта ключ общий, но по-прежнему привязан к адресу', async () => {
    vi.stubEnv('TRUST_PROXY', 'true');

    expect(getTenantRateLimitIdentifier(req({ 'x-forwarded-for': '203.0.113.9' })))
      .toBe('global:203.0.113.9');
  });

  it('недоступность Redis не открывает ворота — счёт продолжается в памяти', async () => {
    // Падение Redis не должно означать «пускать всех»: подсчёт просто
    // переезжает в память того же процесса.
    rateLimiter['redisReady'] = true;
    rateLimiter['redis'] = { evalsha: () => { throw new Error('Redis лёг'); } } as never;

    const cfg = { maxAttempts: 1, windowMs: 60_000, blockDurationMs: 60_000 };
    await rateLimiter.check('redis-down', cfg);
    const second = await rateLimiter.check('redis-down', cfg);

    expect(second.allowed).toBe(false);
  });

  it('обёртка-посредник считает по тому же счётчику', async () => {
    const guard = createRateLimitMiddleware({ maxAttempts: 1, windowMs: 60_000, blockDurationMs: 60_000 });

    expect((await guard('mw-user')).allowed).toBe(true);
    const blocked = await guard('mw-user');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });
});
