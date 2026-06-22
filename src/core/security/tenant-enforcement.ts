/**
 * Tenant Enforcement — Production-Grade
 *
 * Enforces multi-tenant isolation at the application layer.
 * Integrates with AsyncLocalStorage for automatic context propagation.
 *
 * Features:
 * - Tenant resolution from header, session, or default
 * - Automatic tenantWhere() for Prisma queries
 * - Tenant isolation enforcement (throws if cross-tenant access)
 * - Row-Level Security prep (for PostgreSQL)
 *
 * Usage:
 *   import { requireTenant, tenantWhere, getCurrentTenant } from '@/core/security/tenant-enforcement';
 *
 *   // In API route:
 *   const tenantId = requireTenant(user);
 *   const reports = await db.report.findMany({
 *     where: tenantWhere({ userId }),
 *   });
 */

import { AsyncLocalStorage } from 'async_hooks';
import { ServiceError } from '@/lib/service-error';

// ============================================================
// Tenant Context
// ============================================================

export interface TenantInfo {
  id: string;
  slug: string;
  plan: string;
  isActive: boolean;
  maxUsers: number;
}

export interface UserWithTenant {
  id: string;
  role: string;
  tenantId: string | null;
}

// ============================================================
// AsyncLocalStorage for Tenant Context
// ============================================================

export interface TenantCorrelationContext {
  tenantId: string | null;
  userId: string | null;
  requestId: string | null;
}

const tenantStorage = new AsyncLocalStorage<TenantCorrelationContext>();

export function runWithTenantContext<T>(
  ctx: TenantCorrelationContext,
  fn: () => T
): T {
  return tenantStorage.run(ctx, fn);
}

export function getCurrentTenantContext(): TenantCorrelationContext | null {
  return tenantStorage.getStore() || null;
}

// ============================================================
// Tenant Resolution
// ============================================================

export function resolveTenantId(user: UserWithTenant, headerTenantId?: string | null): string | null {
  // Priority: header > user's tenant > default env
  return headerTenantId || user.tenantId || process.env.DEFAULT_TENANT_ID || null;
}

export function isMultiTenantMode(): boolean {
  const mtm = process.env.MULTI_TENANT_MODE;
  return mtm === 'multi' || mtm === 'true';
}

// ============================================================
// Tenant Enforcement
// ============================================================

/**
 * Require tenant ID in multi-tenant mode.
 * Throws 403 if multi-tenant mode but no tenant resolved.
 */
export function requireTenant(user: UserWithTenant, headerTenantId?: string | null): string {
  const tenantId = resolveTenantId(user, headerTenantId);

  if (isMultiTenantMode() && !tenantId) {
    throw new ServiceError('Tenant ID is required in multi-tenant mode', 403);
  }

  return tenantId || '';
}

/**
 * Validate tenant ID exists and is active.
 * Call this when tenant ID comes from untrusted source (header, URL).
 */
export async function validateTenantExists(tenantId: string): Promise<TenantInfo> {
  const { db } = await import('@/lib/db');

  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
  });

  if (!tenant) {
    throw new ServiceError('Tenant not found', 404);
  }

  if (!tenant.isActive) {
    throw new ServiceError('Tenant is suspended', 403);
  }

  return {
    id: tenant.id,
    slug: tenant.slug,
    plan: tenant.plan,
    isActive: tenant.isActive,
    maxUsers: tenant.maxUsers,
  };
}

/**
 * Enforce tenant plan limits.
 */
export function enforceTenantPlan(tenant: TenantInfo, check: {
  maxUsers?: number;
  requiredPlan?: string;
}): void {
  if (check.maxUsers !== undefined && tenant.maxUsers < check.maxUsers) {
    throw new ServiceError(
      `Tenant plan allows max ${tenant.maxUsers} users`,
      403
    );
  }

  if (check.requiredPlan) {
    const planOrder = ['free', 'starter', 'pro', 'enterprise'];
    const currentLevel = planOrder.indexOf(tenant.plan);
    const requiredLevel = planOrder.indexOf(check.requiredPlan);

    if (currentLevel < requiredLevel) {
      throw new ServiceError(
        `Feature requires ${check.requiredPlan} plan or higher`,
        403
      );
    }
  }
}

// ============================================================
// Tenant-Aware Query Helpers
// ============================================================

/**
 * Create tenant-aware where clause.
 * In multi-tenant mode, automatically adds tenantId filter.
 *
 * Usage:
 *   const reports = await db.report.findMany({
 *     where: tenantWhere({ userId: 'user-1' }),
 *   });
 */
export function tenantWhere<T extends Record<string, unknown>>(
  where: T,
  tenantId?: string | null
): T {
  const effectiveTenantId = tenantId || getCurrentTenantContext()?.tenantId;

  if (isMultiTenantMode() && effectiveTenantId) {
    return { ...where, tenantId: effectiveTenantId } as T;
  }

  return where;
}

/**
 * Enforce that the requested resource belongs to the current tenant.
 * Throws 403 if cross-tenant access is attempted.
 */
export function assertTenantOwnership(resourceTenantId: string | null, headerTenantId?: string | null): void {
  if (!isMultiTenantMode()) return;

  const effectiveTenantId = headerTenantId || getCurrentTenantContext()?.tenantId;

  if (effectiveTenantId && resourceTenantId !== effectiveTenantId) {
    throw new ServiceError('Access denied: resource belongs to different tenant', 403);
  }
}

// ============================================================
// User Site Access (Tenant-Site Hierarchy)
// ============================================================

export async function getUserSites(userId: string): Promise<string[]> {
  const { db } = await import('@/lib/db');

  const assignments = await db.userSiteAssignment.findMany({
    where: { userId },
    select: { siteId: true },
  });

  return assignments.map(a => a.siteId);
}

export async function assertUserHasSiteAccess(
  userId: string,
  siteId: string,
  role: string
): Promise<void> {
  // Admin/Dispatcher has access to all sites
  if (role === 'ADMIN' || role === 'DISPATCHER') return;

  const { db } = await import('@/lib/db');

  const assignment = await db.userSiteAssignment.findFirst({
    where: { userId, siteId },
  });

  if (!assignment) {
    throw new ServiceError('Access denied: no site assignment', 403);
  }
}

// ============================================================
// PostgreSQL Row-Level Security Setup
//
// When using PostgreSQL, you can enable RLS for automatic
// tenant isolation at the database level:
//
// ALTER TABLE "Report" ENABLE ROW LEVEL SECURITY;
//
// CREATE POLICY tenant_isolation_policy ON "Report"
//   USING (
//     COALESCE("tenantId", current_setting('app.current_tenant', true)) = current_setting('app.current_tenant', true)
//   );
//
// Then in the app, set the session variable:
//   await db.$executeRaw`SET app.current_tenant = ${tenantId}`;
// ============================================================

export async function setPostgresTenantContext(tenantId: string | null): Promise<void> {
  if (!tenantId) return;

  try {
    const { db } = await import('@/lib/db');
    // Parameterized query — prevents SQL injection
    await db.$executeRaw`SET app.current_tenant = ${tenantId}`;
  } catch {
    // Not PostgreSQL or RLS not enabled — skip
  }
}

/**
 * Run a callback inside a transaction with PostgreSQL session variable
 * `app.current_tenant` set transaction-locally. The migration
 * `20260425000000_enable_rls_foundation` reads this variable to enforce RLS
 * on Report/Site/User.
 *
 * Connection-level SET (used by setPostgresTenantContext above) is unreliable
 * with Prisma's connection pool — a follow-up query may be served from a
 * different connection where the variable was never set. set_config with the
 * third arg `true` is transaction-local and survives only within
 * $transaction's callback, which is the safe default.
 *
 * Usage:
 *   await withTenantContext(user.tenantId!, async (tx) => {
 *     return tx.report.findMany();  // RLS-filtered to user's tenant
 *   });
 */
export async function withTenantContext<T>(
  tenantId: string,
  fn: (tx: unknown) => Promise<T>
): Promise<T> {
  if (!tenantId) {
    throw new ServiceError('withTenantContext requires a tenantId', 500);
  }
  const { db } = await import('@/lib/db');
  return db.$transaction(async (tx) => {
    // set_config(name, value, is_local=true) — transaction-scoped, like SET LOCAL.
    await tx.$executeRaw`SELECT set_config('app.current_tenant', ${tenantId}, true)`;
    return fn(tx);
  });
}
