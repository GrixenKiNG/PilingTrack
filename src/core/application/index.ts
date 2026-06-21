/**
 * Core Application Layer — Shared application services
 */

export { withCsrf } from '@/lib/csrf-protection';
export { rateLimiter, getRateLimitIdentifier, AUTH_RATE_LIMIT, PIN_RATE_LIMIT } from '@/lib/rate-limiter';
// eslint-disable-next-line no-restricted-imports -- intentional public re-export facade; implementation stays in services/ until the services->modules migration completes (CLAUDE.md)
export {
  withTenantContext,
  requireTenant,
  tenantWhere,
  getCurrentTenantId,
  applySecurityHeaders,
} from '@/services/tenancy/tenant-enforcement-middleware';
