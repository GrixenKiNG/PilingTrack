import {NextResponse, type NextRequest} from 'next/server';
import {withMutation, type ApiWrapperOptions} from '@/core/api-wrapper';
import {ServiceError} from '@/lib/service-error';
import {ReadinessCommandError} from '@/modules/readiness/application/command-pipeline/errors';
import {OperatorCommandError} from '@/modules/operator-v3/application/commands/operator-command-errors';
import type {OperatorCommandContext} from '@/modules/operator-v3/application/commands/operator-command-registry';
import {resolveOperatorV3RequestContext} from './request-context';

export function operatorV3ErrorResponse(
  error: OperatorCommandError | ReadinessCommandError,
  context: Pick<OperatorCommandContext, 'requestId' | 'correlationId'>,
): NextResponse {
  return NextResponse.json({
    error: {
      code: error.code,
      message: error.message,
      details: error.details ?? {},
      correlationId: context.correlationId,
    },
  }, {
    status: error.status,
    headers: {
      ...error.headers,
      'X-Correlation-Id': context.correlationId,
      'X-Request-Id': context.requestId,
    },
  });
}

export type OperatorV3RouteHandler<T extends unknown[] = []> = (
  request: NextRequest,
  context: OperatorCommandContext,
  ...args: T
) => Promise<NextResponse>;

export function withOperatorV3Command<T extends unknown[]>(
  handler: OperatorV3RouteHandler<T>,
  options?: ApiWrapperOptions,
) {
  return withMutation(async (request: NextRequest, ...args: T) => {
    const resolved = await resolveOperatorV3RequestContext(request);
    if (resolved.response) return resolved.response;
    const context = resolved.context;
    try {
      return await handler(request, context, ...args);
    } catch (error) {
      if (error instanceof OperatorCommandError || error instanceof ReadinessCommandError) {
        return operatorV3ErrorResponse(error, context);
      }
      if (error instanceof ServiceError) {
        const safe = new OperatorCommandError(
          error.status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR',
          error.status,
          /[А-Яа-яЁё]/.test(error.message) ? error.message : 'Действие не выполнено. Проверьте данные и повторите попытку',
        );
        return operatorV3ErrorResponse(safe, context);
      }
      const safe = new OperatorCommandError(
        'INTERNAL_ERROR', 500,
        'Не удалось выполнить действие. Сообщите ответственному сотруднику номер запроса',
      );
      return operatorV3ErrorResponse(safe, context);
    }
  }, options);
}

