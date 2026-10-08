/**
 * Core Application Layer — Shared application services
 */

export { withCsrf } from '@/lib/csrf-protection';
export { rateLimiter, getRateLimitIdentifier, AUTH_RATE_LIMIT } from '@/lib/rate-limiter';
