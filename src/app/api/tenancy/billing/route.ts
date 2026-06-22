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

import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getRequestId, createJsonResponse } from '@/lib/request-context';
import { withApi, withMutation } from '@/core/api-wrapper';
import {
  activateSubscription,
  cancelSubscription,
  getTenantDashboardStats,
  PLANS,
} from '@/services/tenancy/tenant-billing-service';

export const runtime = 'nodejs';

// ============================================================
// GET — Get tenant billing info
// ============================================================

export const GET = withApi(async (request: NextRequest) => {
  const requestId = getRequestId(request);
  const { user, error } = await requireAuth(request);
  if (error) return error;

  const { searchParams } = new URL(request.url);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
  const tenantId = searchParams.get('tenantId') || user!.tenantId;

  if (!tenantId) {
    return createJsonResponse({ error: 'tenantId required' }, { status: 400 }, requestId);
  }

  const stats = await getTenantDashboardStats(tenantId);

  return createJsonResponse({
    ...stats,
    plans: PLANS,
  }, { status: 200 }, requestId);
}, { domain: 'tenancy.billing' });

// ============================================================
// POST — Activate subscription or cancel
// ============================================================

export const POST = withMutation(async (request: NextRequest) => {
  const requestId = getRequestId(request);
  const { user, error } = await requireAuth(request);
  if (error) return error;

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
  if (user!.role !== 'ADMIN') {
    return createJsonResponse({ error: 'Admin access required' }, { status: 403 }, requestId);
  }

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
}, { domain: 'tenancy.billing' });
