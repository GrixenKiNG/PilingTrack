/**
 * Tenant Rate Limiter — Per-tenant backpressure
 *
 * F10 Guarantee: DB overload prevention via per-tenant rate limiting.
 * Each tenant gets a fair share of throughput — no single tenant can
 * overwhelm the system with burst sync operations.
 *
 * Uses Redis for distributed rate limiting with in-memory fallback.
 */

import Redis from 'ioredis';
import { logger } from '@/lib/logger';

// ============================================================
// Configuration
// ============================================================

export interface TenantRateLimitConfig {
  maxRequestsPerSecond: number;  // Per-tenant limit
  burstMultiplier: number;       // Allow burst up to N × base rate
  blockDurationMs: number;       // How long to block after exceeding
}

const DEFAULT_CONFIG: TenantRateLimitConfig = {
  maxRequestsPerSecond: 50,       // 50 req/s per tenant
  burstMultiplier: 2,             // Allow up to 100 req/s burst
  blockDurationMs: 10_000,        // 10s block
};

// ============================================================
// Lua Script — Atomic rate check
// ============================================================

const TENANT_RATE_LIMIT_LUA = `
local key = KEYS[1]
local max_req = tonumber(ARGV[1])
local burst_max = tonumber(ARGV[2])
local block_duration = tonumber(ARGV[3])
local now = tonumber(ARGV[4])

-- Check if tenant is blocked
local blocked_until = redis.call('GET', key .. ':blocked')
if blocked_until then
  local blocked_until_num = tonumber(blocked_until)
  if blocked_until_num and now < blocked_until_num then
    return {1, blocked_until_num - now}  -- blocked
  else
    redis.call('DEL', key .. ':blocked')
  end
end

-- Get current request count in window (1 second sliding window)
local current = redis.call('GET', key)
local current_num = current and tonumber(current) or 0

-- Check limits
if current_num >= burst_max then
  -- Exceeded burst — block tenant
  redis.call('SET', key .. ':blocked', now + block_duration, 'EX', math.ceil(block_duration / 1000))
  return {1, block_duration}  -- blocked
end

-- Increment counter
redis.call('INCR', key)
redis.call('EXPIRE', key, 1)  -- 1 second TTL

return {0, max_req - current_num - 1}  -- allowed, remaining
`;

// ============================================================
// Tenant Rate Limiter
// ============================================================

class TenantRateLimiter {
  private redis: Redis | null = null;
  private readonly inMemoryStore = new Map<string, { count: number; windowStart: number }>();
  private readonly blockedTenants = new Map<string, number>();
  private luaSha: string | null = null;
  private initialized = false;

  constructor(private config: TenantRateLimitConfig = DEFAULT_CONFIG) {}

  /**
   * Initialize Redis connection and load Lua script.
   */
  async init(redisUrl?: string): Promise<void> {
    if (this.initialized) return;

    const url = redisUrl || process.env.REDIS_URL;
    if (url) {
      try {
        this.redis = new Redis(url, {
          maxRetriesPerRequest: 2,
          connectTimeout: 5000,
          lazyConnect: true,
        });

        // Load Lua script
        const sha = await this.redis.script('LOAD', TENANT_RATE_LIMIT_LUA);
        this.luaSha = typeof sha === 'string' ? sha : null;
        this.initialized = true;

        logger.info('Tenant rate limiter initialized with Redis');
      } catch (error) {
        logger.warn('Tenant rate limiter falling back to in-memory', { error });
        this.initialized = true; // Mark as initialized (in-memory mode)
      }
    } else {
      this.initialized = true; // In-memory mode
    }
  }

  /**
   * Check if tenant is allowed to make a request.
   *
   * @param tenantId — Tenant identifier
   * @returns { allowed: boolean; remaining?: number; retryAfterMs?: number }
   */
  async check(tenantId: string): Promise<{
    allowed: boolean;
    remaining?: number;
    retryAfterMs?: number;
  }> {
    const now = Date.now();
    const key = `tenant_rate:${tenantId}`;
    const burstMax = this.config.maxRequestsPerSecond * this.config.burstMultiplier;

    // Check in-memory block list first
    const blockedUntil = this.blockedTenants.get(tenantId);
    if (blockedUntil && now < blockedUntil) {
      return {
        allowed: false,
        retryAfterMs: blockedUntil - now,
      };
    }

    if (blockedUntil) {
      this.blockedTenants.delete(tenantId);
    }

    // Redis mode
    if (this.redis && this.luaSha) {
      try {
        const result = await this.redis.evalsha(
          this.luaSha,
          1,
          key,
          this.config.maxRequestsPerSecond,
          burstMax,
          this.config.blockDurationMs,
          now
        ) as [number, number];

        const [blocked, value] = result;

        if (blocked === 1) {
          return {
            allowed: false,
            retryAfterMs: value,
          };
        }

        return {
          allowed: true,
          remaining: value,
        };
      } catch {
        // Fallback to in-memory
      }
    }

    // In-memory fallback
    const entry = this.inMemoryStore.get(key) || { count: 0, windowStart: now };

    // Reset window if expired
    if (now - entry.windowStart > 1000) {
      entry.count = 0;
      entry.windowStart = now;
    }

    entry.count++;
    this.inMemoryStore.set(key, entry);

    if (entry.count >= burstMax) {
      const blockUntil = now + this.config.blockDurationMs;
      this.blockedTenants.set(tenantId, blockUntil);

      return {
        allowed: false,
        retryAfterMs: this.config.blockDurationMs,
      };
    }

    return {
      allowed: true,
      remaining: burstMax - entry.count,
    };
  }

  /**
   * Reset rate limit for tenant (admin action).
   */
  reset(tenantId: string): void {
    this.blockedTenants.delete(tenantId);
    this.inMemoryStore.delete(`tenant_rate:${tenantId}`);

    if (this.redis) {
      this.redis.del(`tenant_rate:${tenantId}`, `tenant_rate:${tenantId}:blocked`);
    }
  }

  /**
   * Get stats for monitoring.
   */
  getStats(): {
    blockedTenants: number;
    activeTenants: number;
  } {
    const now = Date.now();
    let blockedCount = 0;

    for (const [tenantId, blockedUntil] of this.blockedTenants.entries()) {
      if (now < blockedUntil) {
        blockedCount++;
      } else {
        this.blockedTenants.delete(tenantId);
      }
    }

    return {
      blockedTenants: blockedCount,
      activeTenants: this.inMemoryStore.size,
    };
  }
}

// Singleton
export const tenantRateLimiter = new TenantRateLimiter();

/**
 * Initialize on first use.
 */
export async function initTenantRateLimiter(): Promise<void> {
  await tenantRateLimiter.init();
}
