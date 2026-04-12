import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createJsonResponse, getRequestId } from '@/lib/request-context';
import { createLogoutResponse } from '@/services/auth/auth-service';
import { recordAuditEvent } from '@/services/audit/audit-service';
import { resolveTenantContext } from '@/services/tenancy/tenant-context-service';
import { withCsrf } from '@/lib/csrf-protection';


export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const csrfResponse = withCsrf(request);
  if (csrfResponse) return csrfResponse;

  const requestId = getRequestId(request);

  try {
    const tenantContext = resolveTenantContext(request);
    const { user } = await requireAuth(request);

    if (user) {
      await recordAuditEvent({
        action: 'auth.logout',
        scope: 'auth',
        actorId: user.id,
        tenantId: tenantContext.tenantId,
        requestId,
        metadata: { role: user.role },
      });
    }

    return createLogoutResponse(requestId);
  } catch {
    return createJsonResponse({ error: 'Logout failed', requestId }, { status: 500 }, requestId);
  }
}
