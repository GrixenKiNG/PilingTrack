/**
 * Rate Limiter — Redis-backed with Lua script for atomicity
 * Protects against brute-force attacks on auth endpoints
 *
 * Uses Redis for distributed rate limiting with graceful degradation
 * to in-memory Map when Redis is unavailable.
 */

import Redis from 'ioredis';
import { logger } from '@/lib/logger';

export interface RateLimitConfig {
  maxAttempts: number;
  windowMs: number;
  blockDurationMs: number;
}

// Default configs
export const AUTH_RATE_LIMIT: RateLimitConfig = {
  maxAttempts: 5,          // 5 попыток
  windowMs: 15 * 60 * 1000, // 15 минут
  blockDurationMs: 30 * 60 * 1000, // блокировка на 30 минут
};

export const PIN_RATE_LIMIT: RateLimitConfig = {
  maxAttempts: 3,          // 3 попытки для PIN
  windowMs: 10 * 60 * 1000, // 10 минут
  blockDurationMs: 60 * 60 * 1000, // блокировка на 1 час
};

// Lua script for atomic rate limit check + increment
const RATE_LIMIT_LUA = `
local counter_key = KEYS[1]
local block_key = KEYS[2]
local max_attempts = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local block_duration_ms = tonumber(ARGV[3])
local now = tonumber(ARGV[4])

-- Check if identifier is blocked
local blocked_until = redis.call('GET', block_key)
if blocked_until then
  local blocked_until_num = tonumber(blocked_until)
  if blocked_until_num and now < blocked_until_num then
    return {1, 0, blocked_until_num}  -- blocked
  else
    -- Block expired, remove it
    redis.call('DEL', block_key)
    redis.call('DEL', counter_key)
  end
end

-- Get or create counter
local current_count = redis.call('GET', counter_key)
if not current_count then
  -- First attempt in window
  redis.call('SET', counter_key, 1, 'PX', window_ms)
  return {0, max_attempts - 1, 0}  -- allowed
end

local count = tonumber(current_count) or 0
count = count + 1

if count > max_attempts then
  -- Exceeded limit — block the identifier
  local block_until = now + block_duration_ms
  redis.call('SET', block_key, block_until, 'PX', block_duration_ms)
  redis.call('DEL', counter_key)
  return {1, 0, block_until}  -- blocked
end

-- Update counter
redis.call('SET', counter_key, count, 'PX', window_ms)
local remaining = max_attempts - count
if remaining < 0 then remaining = 0 end

return {0, remaining, 0}  -- allowed
`;

// In-memory fallback entry
interface RateLimitEntry {
  count: number;
  firstAttempt: number;
  lastAttempt: number;
}

class RateLimiter {
  private redis: Redis | null = null;
  private redisReady = false;
  private luaSha = '';

  // In-memory fallback
  private store = new Map<string, RateLimitEntry>();
  private blocked = new Map<string, number>();

  constructor() {
    this.initRedis();
    // Cleanup expired in-memory entries every 5 minutes
    setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  private async initRedis(): Promise<void> {
    try {
      const redisUrl = process.env.REDIS_URL;
      if (!redisUrl) {
        this.redisReady = false;
        return;
      }

      this.redis = new Redis(redisUrl, {
        maxRetriesPerRequest: 2,
        connectTimeout: 3000,
        lazyConnect: true,
        enableOfflineQueue: true,
      });

      this.redis.on('error', (err) => {
        logger.warn('RateLimiter: Redis error', { error: err.message });
        this.redisReady = false;
      });

      this.redis.on('ready', () => {
        logger.info('RateLimiter: Redis ready');
        this.redisReady = true;
      });

      // Connect and load Lua script
      await this.redis.connect();

      // Load Lua script for faster execution (cached SHA)
      const sha = await this.redis.script('LOAD', RATE_LIMIT_LUA);
      this.luaSha = String(sha);
      this.redisReady = true;
    } catch (err) {
      logger.warn('RateLimiter: Redis initialization failed, using in-memory fallback', { error: (err as Error).message });
      this.redisReady = false;
      this.redis = null;
    }
  }

  /**
   * Check if Redis is available.
   */
  isRedisAvailable(): boolean {
    return this.redisReady && this.redis !== null;
  }

  /**
   * Check if request is allowed
   * @returns { allowed: boolean, remaining: number, retryAfter?: number }
   */
  async check(identifier: string, config: RateLimitConfig): Promise<{
    allowed: boolean;
    remaining: number;
    retryAfter?: number;
    blockedUntil?: number;
  }> {
    if (this.isRedisAvailable()) {
      try {
        return await this.checkRedis(identifier, config);
      } catch (err) {
        logger.warn('RateLimiter: Redis check failed, falling back to in-memory', { error: (err as Error).message });
        this.redisReady = false;
      }
    }
    return this.checkInMemory(identifier, config);
  }

  private async checkRedis(
    identifier: string,
    config: RateLimitConfig,
  ): Promise<{
    allowed: boolean;
    remaining: number;
    retryAfter?: number;
    blockedUntil?: number;
  }> {
    if (!this.redis) {
      throw new Error('Redis not initialized');
    }

    const counterKey = `rl:${identifier}`;
    const blockKey = `rl:blocked:${identifier}`;
    const now = Date.now();

    let result: unknown[];

    try {
      // Try EVALSHA first (faster, uses cached script)
      result = await this.redis.evalsha(
        this.luaSha,
        2,
        counterKey,
        blockKey,
        String(config.maxAttempts),
        String(config.windowMs),
        String(config.blockDurationMs),
        String(now),
      ) as unknown[];
    } catch {
      // Script not cached — use EVAL
      result = await this.redis.eval(
        RATE_LIMIT_LUA,
        2,
        counterKey,
        blockKey,
        String(config.maxAttempts),
        String(config.windowMs),
        String(config.blockDurationMs),
        String(now),
      ) as unknown[];
    }

    const isBlocked = result[0] as number;
    const remaining = result[1] as number;
    const blockedUntilTs = result[2] as number;

    if (isBlocked === 1) {
      return {
        allowed: false,
        remaining: 0,
        retryAfter: Math.ceil((blockedUntilTs - now) / 1000),
        blockedUntil: blockedUntilTs,
      };
    }

    return {
      allowed: true,
      remaining,
    };
  }

  private checkInMemory(identifier: string, config: RateLimitConfig): {
    allowed: boolean;
    remaining: number;
    retryAfter?: number;
    blockedUntil?: number;
  } {
    const now = Date.now();

    // Check if identifier is blocked
    const blockedUntil = this.blocked.get(identifier);
    if (blockedUntil && now < blockedUntil) {
      return {
        allowed: false,
        remaining: 0,
        retryAfter: Math.ceil((blockedUntil - now) / 1000),
        blockedUntil,
      };
    }

    // Remove expired block
    if (blockedUntil && now >= blockedUntil) {
      this.blocked.delete(identifier);
      this.store.delete(identifier);
    }

    const entry = this.store.get(identifier);

    // First attempt or expired window
    if (!entry || now - entry.firstAttempt > config.windowMs) {
      this.store.set(identifier, {
        count: 1,
        firstAttempt: now,
        lastAttempt: now,
      });
      return { allowed: true, remaining: config.maxAttempts - 1 };
    }

    // Within window
    entry.count++;
    entry.lastAttempt = now;

    if (entry.count > config.maxAttempts) {
      // Block the identifier
      const blockUntil = now + config.blockDurationMs;
      this.blocked.set(identifier, blockUntil);

      return {
        allowed: false,
        remaining: 0,
        retryAfter: Math.ceil(config.blockDurationMs / 1000),
        blockedUntil: blockUntil,
      };
    }

    return {
      allowed: true,
      remaining: config.maxAttempts - entry.count,
    };
  }

  /**
   * Reset rate limit for identifier (e.g., after successful login)
   */
  async reset(identifier: string): Promise<void> {
    if (this.isRedisAvailable()) {
      try {
        await this.redis?.del(`rl:${identifier}`, `rl:blocked:${identifier}`);
        return;
      } catch {
        this.redisReady = false;
      }
    }
    // Fallback to in-memory
    this.store.delete(identifier);
    this.blocked.delete(identifier);
  }

  /**
   * Clear ALL rate limit entries — for testing only.
   */
  clearAll(): void {
    this.store.clear();
    this.blocked.clear();
  }

  /**
   * Get current status without incrementing count
   */
  async getStatus(identifier: string): Promise<{
    attempts: number;
    blocked: boolean;
    blockedUntil?: number;
  }> {
    if (this.isRedisAvailable()) {
      try {
        const counterKey = `rl:${identifier}`;
        const blockKey = `rl:blocked:${identifier}`;

        const [counterRaw, blockedRaw] = await this.redis!.mget(counterKey, blockKey);
        const attempts = counterRaw ? parseInt(counterRaw, 10) : 0;
        const now = Date.now();

        if (blockedRaw) {
          const blockedUntil = parseInt(blockedRaw, 10);
          if (blockedUntil > now) {
            return { attempts, blocked: true, blockedUntil };
          }
        }

        return { attempts, blocked: false };
      } catch {
        this.redisReady = false;
      }
    }

    // Fallback to in-memory
    const entry = this.store.get(identifier);
    const blockedUntil = this.blocked.get(identifier);
    const now = Date.now();

    return {
      attempts: entry?.count || 0,
      blocked: !!(blockedUntil && now < blockedUntil),
      blockedUntil: blockedUntil && now < blockedUntil ? blockedUntil : undefined,
    };
  }

  /**
   * Cleanup expired in-memory entries
   */
  private cleanup(): void {
    const now = Date.now();

    // Remove expired rate limit entries
    for (const [key, entry] of this.store.entries()) {
      if (now - entry.firstAttempt > 60 * 60 * 1000) { // 1 hour
        this.store.delete(key);
      }
    }

    // Remove expired blocks
    for (const [key, blockedUntil] of this.blocked.entries()) {
      if (now >= blockedUntil) {
        this.blocked.delete(key);
        this.store.delete(key);
      }
    }
  }

  /**
   * Get stats for monitoring
   */
  async getStats(): Promise<{
    activeIdentifiers: number;
    blockedIdentifiers: number;
    totalEntries: number;
    redisAvailable: boolean;
  }> {
    if (this.isRedisAvailable()) {
      try {
        // Redis doesn't track "active" count efficiently without SCAN
        // Return approximate stats from in-memory fallback store + redis flag
        return {
          activeIdentifiers: this.store.size,
          blockedIdentifiers: 0,
          totalEntries: this.store.size + this.blocked.size,
          redisAvailable: true,
        };
      } catch {
        this.redisReady = false;
      }
    }

    // Fallback to in-memory
    const now = Date.now();
    let blockedCount = 0;

    for (const blockedUntil of this.blocked.values()) {
      if (now < blockedUntil) blockedCount++;
    }

    return {
      activeIdentifiers: this.store.size,
      blockedIdentifiers: blockedCount,
      totalEntries: this.store.size + this.blocked.size,
      redisAvailable: false,
    };
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
      this.redisReady = false;
    }
  }
}

// Singleton instance
export const rateLimiter = new RateLimiter();

/**
 * Express/Next.js middleware for rate limiting
 */
export function createRateLimitMiddleware(config: RateLimitConfig) {
  return async (identifier: string) => {
    return await rateLimiter.check(identifier, config);
  };
}

/**
 * Helper to extract identifier from request.
 * Supports tenant-aware rate limiting.
 */
export function getRateLimitIdentifier(
  request: Request,
  fallback: string = 'unknown',
  options?: { includeTenant?: boolean }
): string {
  // Try to get from X-Forwarded-For (behind proxy/load balancer)
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0].trim() : request.headers.get('x-real-ip') || fallback;

  // Add tenant ID for tenant-aware rate limiting
  if (options?.includeTenant) {
    const tenantId = request.headers.get('x-tenant-id');
    return tenantId ? `tenant:${tenantId}:ip:${ip}` : `ip:${ip}`;
  }

  return ip === fallback ? `host-${request.headers.get('host') || 'localhost'}` : ip;
}

/**
 * Get tenant-scoped rate limit identifier.
 * Falls back to IP-based limiting if no tenant header.
 */
export function getTenantRateLimitIdentifier(request: Request): string {
  const tenantId = request.headers.get('x-tenant-id');
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0].trim() : request.headers.get('x-real-ip') || 'unknown';

  return tenantId ? `tenant:${tenantId}:${ip}` : `global:${ip}`;
}
