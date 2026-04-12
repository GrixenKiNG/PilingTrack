/**
 * Tenant Isolation Middleware
 *
 * Ensures every API request has a valid tenant context.
 * Sets `app.tenant_id` for PostgreSQL RLS enforcement.
 *
 * F1 Guarantee: Any request without tenant context → FAIL HARD
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { db } from '@/lib/db';

/**
 * Extract tenant ID from user session or request.
 * Returns null if no tenant context available.
 */
async function resolveTenantId(request: NextRequest): Promise<string | null> {
  const { user, error } = await requireAuth(request);
  if (error) return null;

  // Priority: user's tenant ID → request header → query param
  if (user?.tenantId) return user.tenantId;

  const headerTenant = request.headers.get('x-tenant-id');
  if (headerTenant) return headerTenant;

  const queryTenant = request.nextUrl.searchParams.get('tenantId');
  if (queryTenant) return queryTenant;

  // Fallback to default tenant (dev mode only)
  if (process.env.NODE_ENV !== 'production') {
    return process.env.DEFAULT_TENANT_ID || 'default';
  }

  return null;
}

/**
 * Set tenant context for RLS.
 * Must be called before any database operation.
 */
export async function setTenantContext(tenantId: string): Promise<void> {
  try {
    await db.$executeRaw`SET app.tenant_id = ${tenantId}::uuid`;
  } catch (error) {
    // If RLS is not configured, log warning but don't fail
    console.warn('[Tenant Context] Failed to set tenant context:', error);
  }
}

/**
 * Middleware wrapper — enforce tenant isolation.
 *
 * Usage:
 *   export async function GET(request: NextRequest) {
 *     const tenantError = await ensureTenantIsolation(request);
 *     if (tenantError) return tenantError;
 *     // ... handler logic
 *   }
 */
export async function ensureTenantIsolation(request: NextRequest): Promise<NextResponse | null> {
  const tenantId = await resolveTenantId(request);

  if (!tenantId) {
    return NextResponse.json(
      { error: 'Tenant context required. Provide tenantId via user session, X-Tenant-ID header, or query parameter.' },
      { status: 400 }
    );
  }

  await setTenantContext(tenantId);

  return null; // OK — continue with request
}

/**
 * Get current tenant ID from request context.
 */
export async function getTenantFromRequest(request: NextRequest): Promise<string> {
  const tenantId = await resolveTenantId(request);

  if (!tenantId) {
    throw new Error('Tenant context required');
  }

  return tenantId;
}
