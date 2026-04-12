/**
 * Core Security — Production-Grade
 *
 * - tenant-enforcement: Multi-tenant isolation
 * - idempotency: Prevent duplicate API requests
 * - refresh-tokens: Secure session management with rotation
 */

// Tenant Enforcement
export {
  requireTenant,
  validateTenantExists,
  enforceTenantPlan,
  tenantWhere,
  assertTenantOwnership,
  getUserSites,
  assertUserHasSiteAccess,
  setPostgresTenantContext,
  resolveTenantId,
  isMultiTenantMode,
  runWithTenantContext,
  getCurrentTenantContext,
} from './tenant-enforcement';
export type {
  TenantInfo,
  UserWithTenant,
  TenantCorrelationContext,
} from './tenant-enforcement';

// Idempotency
export {
  withIdempotency,
  acquireIdempotencyKey,
  completeIdempotencyKey,
  failIdempotencyKey,
  cleanupExpiredKeys,
} from './idempotency';

// Refresh Tokens
export {
  createRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
  revokeTokenFamily,
  cleanupExpiredRefreshTokens,
  getUserActiveSessions,
} from './refresh-tokens';
export type { TokenPair } from './refresh-tokens';
