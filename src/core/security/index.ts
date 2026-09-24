/**
 * Core Security — Production-Grade
 *
 * - tenant-enforcement: Multi-tenant isolation
 * - idempotency: Prevent duplicate API requests
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
