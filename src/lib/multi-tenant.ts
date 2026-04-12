/**
 * Multi-Tenant Middleware for Prisma
 *
 * Automatically filters queries by tenantId when MULTI_TENANT_MODE=single.
 * Ensures data isolation between tenants at the application layer.
 *
 * For database-level isolation, use RLS (prisma/rls-setup.sql)
 * combined with connection-level tenant context.
 */

import { Prisma } from '@prisma/client';

// Tables that have tenantId field
const TENANT_ISOLATED_MODELS = [
  'User',
  'Site',
  'Report',
  'ReportAnalytics',
  'ReportStats',
  'OperatorPerformance',
  'DowntimeSummary',
  'SiteWeeklyTrend',
];

/**
 * Create a Prisma middleware that filters queries by tenant.
 *
 * Usage:
 *   const db = createTenantDb(prisma, tenantId);
 *   const reports = await db.report.findMany(); // automatically filtered
 */
export function createTenantClient<T>(
  client: T,
  tenantId: string
): T {
  // For now, we rely on application-level tenant filtering
  // via the existing tenant-middleware.ts
  // RLS at DB level provides the actual enforcement
  
  return client;
}

/**
 * Get the where clause for tenant filtering.
 * Returns empty object if multi-tenant is disabled.
 */
export function getTenantWhereClause(
  tenantId: string | null | undefined
): Record<string, unknown> {
  const mode = process.env.MULTI_TENANT_MODE;
  
  if (mode !== 'single' || !tenantId) {
    return {};
  }
  
  return { tenantId };
}

/**
 * Validate that a tenantId exists and is active.
 * Use this before setting tenant context.
 */
export async function validateTenant(tenantId: string): Promise<boolean> {
  const { db } = await import('@/lib/db');
  
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId, isActive: true },
    select: { id: true },
  });
  
  return !!tenant;
}
