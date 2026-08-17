import type {NextRequest, NextResponse} from 'next/server';
import {requireAuth} from '@/lib/auth';
import {getRequestId} from '@/lib/request-context';
import {canActAs} from '@/lib/types';
import {resolveCorrelationId} from '@/modules/readiness/application/command-pipeline/correlation';
import {getPublishedAccessMatrix} from '@/modules/readiness/application/access-matrix-service';
import {effectiveReadinessCapabilities, type ReadinessAbility} from '@/modules/readiness/application/capabilities';
import type {ReadinessAccessMatrix} from '@/modules/readiness/domain/access-matrix';

export interface ReadinessRequestContext {
  tenantId: string;
  actorId: string;
  actorName: string;
  actorRole: string;
  actingAs: string | null;
  requestId: string;
  correlationId: string;
  /**
   * Действующая матрица доступов организации — загружается один раз на запрос.
   *
   * Живёт в контексте, а не запрашивается в каждой проверке: контекст один на
   * запрос, и его же routes передают дальше в команды. Если бы права
   * вычислялись из зашитой таблицы, опубликованная матрица применялась бы
   * только к экрану — интерфейс разрешал бы, а сервер отказывал.
   */
  accessMatrix: ReadinessAccessMatrix;
  /**
   * Права, которыми запрос реально располагает: по матрице и с учётом
   * замещения. Считаются здесь, а не в каждом маршруте, потому что забыть
   * `actingAs` в проверке — значит пустить администратора в режиме механика
   * туда, куда механику нельзя. Один раз посчитали — забыть негде.
   */
  capabilities: ReadonlySet<ReadinessAbility>;
}

/**
 * Итог разбора запроса: ЛИБО контекст, ЛИБО готовый отказ — третьего не дано.
 *
 * Раньше здесь стояло `{context?: ...; response?: ...}` — тип, допускавший и
 * «ни того ни другого». Из-за него каждый из двенадцати маршрутов дописывал к
 * `resolved.context` восклицательный знак, утверждая то, что резолвер и так
 * гарантирует, но не умел выразить. Различимое объединение сужается само: после
 * `if (resolved.response) return resolved.response` контекст непустой по типу.
 */
export type ReadinessRequestResolution =
  | {context: ReadinessRequestContext; response?: undefined}
  | {context?: undefined; response: NextResponse};

export async function resolveReadinessRequestContext(
  request: NextRequest,
  actingAs: string | null = request.headers.get('x-readiness-acting-as'),
): Promise<ReadinessRequestResolution> {
  const requestId = getRequestId(request);
  const {user, error} = await requireAuth(request);
  if (error) return {response: error};
  if (!user?.tenantId) {
    const {NextResponse} = await import('next/server');
    return {response: NextResponse.json({error: {code: 'FORBIDDEN', message: 'Tenant context is required'}}, {status: 403})};
  }
  if (!canActAs(user.role, actingAs)) {
    const {NextResponse} = await import('next/server');
    return {response: NextResponse.json({error: {code: 'FORBIDDEN', message: 'Acting role is not allowed'}}, {status: 403})};
  }
  const accessMatrix = await getPublishedAccessMatrix(user.tenantId);
  return {
    context: {
      tenantId: user.tenantId,
      actorId: user.id,
      actorName: user.name,
      actorRole: user.role,
      actingAs,
      requestId,
      correlationId: resolveCorrelationId(request.headers.get('x-correlation-id') ?? requestId),
      accessMatrix,
      capabilities: effectiveReadinessCapabilities(user.role, actingAs, accessMatrix),
    },
  };
}
