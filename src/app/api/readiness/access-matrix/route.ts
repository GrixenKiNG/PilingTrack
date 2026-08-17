import type {NextRequest} from 'next/server';
import {NextResponse} from 'next/server';
import {
  getAccessMatrix,
  publishAccessMatrix,
  saveAccessMatrixDraft,
} from '@/modules/readiness/application/access-matrix-service';
import {resolveReadinessRequestContext} from '../_shared/request-context';
import {withReadinessCommand} from '../_shared/route-adapter';

export const runtime = 'nodejs';

/**
 * Матрица доступов: чтение, черновик, публикация.
 *
 * Право `readiness.rules.manage` проверяется по ДЕЙСТВУЮЩЕЙ матрице — то есть
 * по той же, которую этот маршрут и меняет. Так владелец может передать
 * настройку доступов другой роли, опубликовав изменение.
 */
export async function GET(request: NextRequest) {
  const resolved = await resolveReadinessRequestContext(request);
  if (resolved.response) return resolved.response;
  const context = resolved.context;
  if (!context.capabilities.has('readiness.rules.manage')) {
    return NextResponse.json({error: {code: 'FORBIDDEN', message: 'Недостаточно прав для настройки доступов'}}, {status: 403});
  }
  return NextResponse.json({data: await getAccessMatrix(context.tenantId)});
}

export const PUT = withReadinessCommand(async (request, context) => {
  if (!context.capabilities.has('readiness.rules.manage')) {
    return NextResponse.json({error: {code: 'FORBIDDEN', message: 'Недостаточно прав для настройки доступов'}}, {status: 403});
  }
  const body = await request.json().catch(() => null);
  if (body === null) {
    return NextResponse.json({error: {code: 'VALIDATION_ERROR', message: 'Тело запроса должно быть в формате JSON'}}, {status: 400});
  }
  const state = await saveAccessMatrixDraft(context.tenantId, body, {
    id: context.actorId, name: context.actorName, role: context.actorRole, actingAs: context.actingAs,
  });
  return NextResponse.json({data: state});
}, {domain: 'readiness-access-matrix'});

export const POST = withReadinessCommand(async (_request, context) => {
  if (!context.capabilities.has('readiness.rules.manage')) {
    return NextResponse.json({error: {code: 'FORBIDDEN', message: 'Недостаточно прав для настройки доступов'}}, {status: 403});
  }
  const state = await publishAccessMatrix(context.tenantId, {
    id: context.actorId, name: context.actorName, role: context.actorRole, actingAs: context.actingAs,
  });
  return NextResponse.json({data: state});
}, {domain: 'readiness-access-matrix'});
