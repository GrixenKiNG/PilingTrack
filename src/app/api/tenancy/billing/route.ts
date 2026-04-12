/**
 * Tenant Billing API
 *
 * Endpoints:
 * - GET /api/tenancy/billing — Get tenant billing info
 * - POST /api/tenancy/billing/activate — Activate subscription
 * - POST /api/tenancy/billing/cancel — Cancel subscription
 * - GET /api/tenancy/billing/invoices — Get invoices
 * - POST /api/tenancy/billing/invoices/:id/pay — Mark invoice as paid
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getRequestId, createJsonResponse } from '@/lib/request-context';
import { ServiceError } from '@/services/service-error';
import {
  getTenant,
  getTenantInvoices,
  activateSubscription,
  cancelSubscription,
  markInvoicePaid,
  getTenantDashboardStats,
  PLANS,
} from '@/services/tenancy/tenant-billing-service';

export const runtime = 'nodejs';

// ============================================================
// GET — Get tenant billing info
// ============================================================

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  const { user, error } = await requireAuth(request);
  if (error) return error;

  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get('tenantId') || user!.tenantId;

    if (!tenantId) {
      return createJsonResponse({ error: 'tenantId required' }, { status: 400 }, requestId);
    }

    const stats = await getTenantDashboardStats(tenantId);

    return createJsonResponse({
      ...stats,
      plans: PLANS,
    }, { status: 200 }, requestId);
  } catch (err) {
    const message = err instanceof ServiceError ? err.message : 'Internal error';
    const status = err instanceof ServiceError ? err.status : 500;
    return createJsonResponse({ error: message, requestId }, { status }, requestId);
  }
}

// ============================================================
// POST — Activate subscription or cancel
// ============================================================

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  const { user, error } = await requireAuth(request);
  if (error) return error;

  // Only ADMIN can manage billing
  if (user!.role !== 'ADMIN') {
    return createJsonResponse({ error: 'Admin access required' }, { status: 403 }, requestId);
  }

  try {
    const body = await request.json();
    const { tenantId, action, planId } = body;

    if (!tenantId) {
      return createJsonResponse({ error: 'tenantId required' }, { status: 400 }, requestId);
    }

    switch (action) {
      case 'activate':
        if (!planId || !PLANS[planId]) {
          return createJsonResponse({ error: `Invalid plan. Available: ${Object.keys(PLANS).join(', ')}` }, { status: 400 }, requestId);
        }
        const tenant = await activateSubscription(tenantId, planId);
        return createJsonResponse({ tenant, plan: PLANS[planId] }, { status: 200 }, requestId);

      case 'cancel':
        const canceledTenant = await cancelSubscription(tenantId, body.reason);
        return createJsonResponse({ tenant: canceledTenant }, { status: 200 }, requestId);

      default:
        return createJsonResponse({ error: `Unknown action: ${action}` }, { status: 400 }, requestId);
    }
  } catch (err) {
    const message = err instanceof ServiceError ? err.message : 'Internal error';
    const status = err instanceof ServiceError ? err.status : 500;
    return createJsonResponse({ error: message, requestId }, { status }, requestId);
  }
}
