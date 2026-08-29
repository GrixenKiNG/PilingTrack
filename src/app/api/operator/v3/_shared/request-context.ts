import {NextResponse, type NextRequest} from 'next/server';
import {requireAuth} from '@/lib/auth';
import {getRequestId} from '@/lib/request-context';
import {resolveCorrelationId} from '@/modules/readiness/application/command-pipeline/correlation';
import type {OperatorCommandContext} from '@/modules/operator-v3/application/commands/operator-command-registry';

export type OperatorV3RequestResolution =
  | {context: OperatorCommandContext; response?: undefined}
  | {context?: undefined; response: NextResponse};

function error(code: 'UNAUTHENTICATED' | 'FORBIDDEN', message: string, status: 401 | 403) {
  return NextResponse.json({error: {code, message}}, {status});
}

export async function resolveOperatorV3RequestContext(
  request: NextRequest,
): Promise<OperatorV3RequestResolution> {
  const {user, error: authError} = await requireAuth(request);
  if (authError || !user) {
    return {response: error('UNAUTHENTICATED', 'Войдите в систему, чтобы выполнить действие оператора', 401)};
  }
  if (user.role !== 'OPERATOR') {
    return {response: error('FORBIDDEN', 'Действие доступно только оператору', 403)};
  }
  if (!user.tenantId) {
    return {response: error('FORBIDDEN', 'Организация пользователя не определена', 403)};
  }
  const requestId = getRequestId(request);
  return {
    context: {
      tenantId: user.tenantId,
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
      requestId,
      correlationId: resolveCorrelationId(request.headers.get('x-correlation-id') ?? requestId),
    },
  };
}

