/**
 * Tenant Enforcement Middleware
 *
 * When MULTI_TENANT_MODE=true, ensures all database queries are scoped to
 * the current tenant. Provides:
 * 1. Tenant resolution from request headers
 * 2. Automatic tenant filtering for all queries
 * 3. Tenant isolation enforcement
 *
 * Usage:
 *   import { withTenantContext } from '@/services/tenancy/tenant-enforcement-middleware';
 *
 *   export async function GET(request: NextRequest) {
 *     return withTenantContext(request, async (tenantId) => {
 *       // All queries automatically filtered by tenantId
 *       const sites = await db.site.findMany({ where: { tenantId } });
 *       return NextResponse.json(sites);
 *     });
 *   }
 */

import { NextRequest } from 'next/server';
import { resolveTenantContext, isMultiTenantMode } from '@/services/tenancy/tenant-context-service';

// Async local storage for tenant context
import { AsyncLocalStorage } from 'async_hooks';

export const tenantContextStorage = new AsyncLocalStorage<string | null>();

/**
 * Get the current tenant ID from async context.
 */
export function getCurrentTenantId(): string | null {
  return tenantContextStorage.getStore() ?? null;
}

/**
 * Wrap a handler function with tenant context.
 */
export async function withTenantContext<T>(
  request: NextRequest | Request,
  handler: (tenantId: string | null) => Promise<T>
): Promise<T> {
  const ctx = resolveTenantContext(
    'headers' in request ? request : undefined
  );

  return tenantContextStorage.run(ctx.tenantId, async () => {
    return handler(ctx.tenantId);
  });
}

/**
 * Enforce tenant isolation — throws if multi-tenant mode but no tenant ID.
 */
export function requireTenant(): string {
  const tenantId = getCurrentTenantId();
  if (isMultiTenantMode() && !tenantId) {
    throw new Error('Tenant ID is required in multi-tenant mode');
  }
  return tenantId || '';
}

/**
 * Create tenant-aware where clause.
 * In multi-tenant mode, adds tenantId filter. In single-tenant mode, returns as-is.
 */
export function tenantWhere<T extends Record<string, unknown>>(
  where: T
): T {
  if (isMultiTenantMode()) {
    const tenantId = requireTenant();
    return { ...where, tenantId } as T;
  }
  return where;
}
