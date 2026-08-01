import type {NextRequest, NextResponse} from 'next/server';
import {requireAuth} from '@/lib/auth';
import {getRequestId} from '@/lib/request-context';
import {resolveCorrelationId} from '@/modules/readiness/application/command-pipeline/correlation';

export interface ReadinessRequestContext {
  tenantId: string;
  actorId: string;
  actorName: string;
  actorRole: string;
  actingAs: string | null;
  requestId: string;
  correlationId: string;
}

export async function resolveReadinessRequestContext(
  request: NextRequest,
  actingAs: string | null = null,
): Promise<{context?: ReadinessRequestContext; response?: NextResponse}> {
  const requestId = getRequestId(request);
  const {user, error} = await requireAuth(request);
  if (error) return {response: error};
  if (!user?.tenantId) {
    const {NextResponse} = await import('next/server');
    return {response: NextResponse.json({error: {code: 'FORBIDDEN', message: 'Tenant context is required'}}, {status: 403})};
  }
  if (actingAs && !(user.role === 'ADMIN' && actingAs === 'MECHANIC')) {
    const {NextResponse} = await import('next/server');
    return {response: NextResponse.json({error: {code: 'FORBIDDEN', message: 'Acting role is not allowed'}}, {status: 403})};
  }
  return {
    context: {
      tenantId: user.tenantId,
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
      actingAs,
      requestId,
      correlationId: resolveCorrelationId(request.headers.get('x-correlation-id') ?? requestId),
    },
  };
}
