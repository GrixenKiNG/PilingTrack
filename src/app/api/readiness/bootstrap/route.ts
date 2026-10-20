import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { ServiceError } from '@/lib/service-error';
import { attachRequestIdHeader, getRequestId } from '@/lib/request-context';
import { isActingRole } from '@/lib/types';
import { can } from '@/services/auth/authorization-service';
import { queryReadinessBootstrap } from '@/modules/readiness/application/bootstrap-query';
import { withReadinessRequestTransaction } from '@/modules/readiness/server';
import {withApi} from '@/core/api-wrapper';

export const runtime = 'nodejs';

function response(body: unknown, status: number, requestId: string) {
  return attachRequestIdHeader(NextResponse.json(body, { status }), requestId);
}

async function handleGet(request: NextRequest) {
  const requestId = getRequestId(request);
  const { user, error } = await requireAuth(request);
  if (error) {
    return attachRequestIdHeader(error, requestId);
  }
  if (!user?.tenantId) {
    return response({ error: 'Требуется контекст организации' }, 403, requestId);
  }
  // Проверка выше сужает тип, но сужение свойства не переживает вход в
  // замыкание ниже — там стояло `user.tenantId!`. Константа сужается честно.
  const tenantId = user.tenantId;
  // Контекст из строки запроса не принимается вовсе. Исполняемая роль — только
  // из сессии: `requireAuth` уже сверил заголовок `x-acting-as` (замещать может
  // лишь администратор и лишь известной ролью) — как в остальных маршрутах
  // контура, см. `_shared/request-context.ts`.
  if (new URL(request.url).searchParams.size > 0) {
    return response({ error: 'Контекст, заданный клиентом, не принимается' }, 400, requestId);
  }
  const actingAs = isActingRole(user.actingAs) ? user.actingAs : null;

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
        incidentsRead: can(user, 'incidents.read'),
      })
    );
    return response({ data, meta: { requestId } }, 200, requestId);
  } catch (caught) {
    if (caught instanceof ServiceError) {
      return response({ error: caught.message }, caught.status, requestId);
    }
    return response({ error: 'Внутренняя ошибка сервера' }, 500, requestId);
  }
}

export const GET = withApi(handleGet, {domain: 'readiness-bootstrap'});
