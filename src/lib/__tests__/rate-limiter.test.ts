import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { rateLimiter, AUTH_RATE_LIMIT, PIN_RATE_LIMIT, getRateLimitIdentifier } from '../rate-limiter';

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
