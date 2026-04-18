import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getRequestId } from '@/lib/request-context';
import { createLogoutResponse } from '@/services/auth/auth-service';
import { recordAuditEvent } from '@/services/audit/audit-service';
import { resolveTenantContext } from '@/services/tenancy/tenant-context-service';
import { withMutation } from '@/core/api-wrapper';

export const runtime = 'nodejs';

export const POST = withMutation(async (request: NextRequest) => {
  const requestId = getRequestId(request);
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
}, { domain: 'auth.logout' });
