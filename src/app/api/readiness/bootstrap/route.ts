import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { ServiceError } from '@/lib/service-error';
import { attachRequestIdHeader, getRequestId } from '@/lib/request-context';
import { canActAs, isActingRole } from '@/lib/types';
import { can } from '@/services/auth/authorization-service';
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
  // Проверка выше сужает тип, но сужение свойства не переживает вход в
  // замыкание ниже — там стояло `user.tenantId!`. Константа сужается честно.
  const tenantId = user.tenantId;
  const searchParams = new URL(request.url).searchParams;
  const actingAs = searchParams.get('actingAs');
  if (
    searchParams.size > (actingAs === null ? 0 : 1)
    || (actingAs !== null && !isActingRole(actingAs))
  ) {
    return response({ error: 'Client-controlled readiness context is not accepted' }, 400, requestId);
  }
  if (!canActAs(user.role, actingAs)) {
    return response({ error: 'Нет доступа к контуру технической готовности' }, 403, requestId);
  }

  try {
    const data = await withReadinessRequestTransaction(tenantId, (tx) =>
      queryReadinessBootstrap(tx, {
        id: user.id,
        name: user.name,
        role: user.role,
        tenantId,
      }, undefined, actingAs, requestId, {
        // Право из прикладной матрицы: контур готовности его не знает, см.
        // ReadinessExternalGrants.
        documentsControl: can(user, 'users.documents.read_all'),
      })
    );
    return response({ data, meta: { requestId } }, 200, requestId);
  } catch (caught) {
    if (caught instanceof ServiceError) {
      return response({ error: caught.message }, caught.status, requestId);
    }
    return response({ error: 'Readiness bootstrap failed' }, 500, requestId);
  }
}
