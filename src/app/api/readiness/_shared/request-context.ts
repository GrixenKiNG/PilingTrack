import type {NextRequest, NextResponse} from 'next/server';
import {requireAuth} from '@/lib/auth';
import {getRequestId} from '@/lib/request-context';
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

/**
 * Разбор запроса к контуру готовности.
 *
 * ПОЧЕМУ ИСПОЛНЯЕМАЯ РОЛЬ БЕРЁТСЯ ИЗ `requireAuth`, А НЕ ИЗ ЗАГОЛОВКА.
 * Раньше здесь читался собственный заголовок `x-readiness-acting-as`, а
 * проверенный `user.actingAs` игнорировался. Клиент же шлёт `x-acting-as` —
 * один раз и на каждом запросе (`lib/api.ts`). Совпадали они ровно в трёх
 * местах, которые дописывали особый заголовок руками: форма наряда, панель
 * дефектов и экран нарядов. Всё остальное уходило без замещения, и
 * администратор в режиме механика выполнял команды с полными правами
 * администратора, а в журнал попадало «замещения не было». Режим «Действую
 * как» существует, чтобы увидеть продукт чужими глазами; полномочия,
 * молча остающиеся своими, делают его бесполезным и вдобавок портят аудит.
 *
 * Источник теперь один. Проверку `canActAs` здесь не повторяем: `requireAuth`
 * уже применил её и обнулил недопустимое замещение — повторная проверка
 * никогда бы не сработала, а её наличие внушало бы, что источников два.
 */
export async function resolveReadinessRequestContext(
  request: NextRequest,
): Promise<ReadinessRequestResolution> {
  const requestId = getRequestId(request);
  const {user, error} = await requireAuth(request);
  if (error) return {response: error};
  if (!user?.tenantId) {
    const {NextResponse} = await import('next/server');
    return {response: NextResponse.json({error: {code: 'FORBIDDEN', message: 'Tenant context is required'}}, {status: 403})};
  }
  //  — не украшение: тип контекста обещает , а
  // отсутствующее поле дало бы  и утекло бы в журнал как таковое.
  const actingAs = user.actingAs ?? null;
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
