import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { ServiceError } from '@/lib/service-error';
import { attachRequestIdHeader, getRequestId } from '@/lib/request-context';
import { queryReadinessBootstrap } from '@/modules/readiness/application/bootstrap-query';
import { withReadinessRequestTransaction } from '@/modules/readiness/infrastructure/tenant-transaction';

export const runtime = 'nodejs';

function response(body: unknown, status: number, requestId: string) {
  return attachRequestIdHeader(NextResponse.json(body, { status }), requestId);
}

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  const { user, error } = await requireAuth(request);
  if (error) {
    return attachRequestIdHeader(error, requestId);
  }
  if (!user?.tenantId) {
    return response({ error: 'Tenant context is required' }, 403, requestId);
  }
  const searchParams = new URL(request.url).searchParams;
  const actingAs = searchParams.get('actingAs');
  if (
    searchParams.size > (actingAs === null ? 0 : 1)
    || (actingAs !== null && actingAs !== 'MECHANIC')
  ) {
    return response({ error: 'Client-controlled readiness context is not accepted' }, 400, requestId);
  }
  if (actingAs === 'MECHANIC' && user.role !== 'ADMIN') {
    return response({ error: 'Readiness access denied' }, 403, requestId);
  }

  try {
    const data = await withReadinessRequestTransaction(user.tenantId, (tx) =>
      queryReadinessBootstrap(tx, {
        id: user.id,
        name: user.name,
        role: user.role,
        tenantId: user.tenantId!,
      }, undefined, actingAs, requestId)
    );
    return response({ data, meta: { requestId } }, 200, requestId);
  } catch (caught) {
    if (caught instanceof ServiceError) {
      return response({ error: caught.message }, caught.status, requestId);
    }
    return response({ error: 'Readiness bootstrap failed' }, 500, requestId);
  }
}
