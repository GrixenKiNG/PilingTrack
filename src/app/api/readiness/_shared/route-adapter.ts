import type {NextRequest, NextResponse} from 'next/server';
import {withMutation, type ApiWrapperOptions} from '@/core/api-wrapper';
import {ReadinessCommandError} from '@/modules/readiness/application/command-pipeline/errors';
import {resolveReadinessRequestContext, type ReadinessRequestContext} from './request-context';
import {readinessErrorResponse} from './response';

export type ReadinessRouteHandler<T extends unknown[] = []> = (
  request: NextRequest,
  context: ReadinessRequestContext,
  ...args: T
) => Promise<NextResponse>;

export function withReadinessCommand<T extends unknown[]>(
  handler: ReadinessRouteHandler<T>,
  options?: ApiWrapperOptions,
) {
  return withMutation(async (request: NextRequest, ...args: T) => {
    const resolved = await resolveReadinessRequestContext(request);
    if (resolved.response) return resolved.response;
    const context = resolved.context;
    try {
      return await handler(request, context, ...args);
    } catch (error) {
      if (error instanceof ReadinessCommandError) {
        return readinessErrorResponse(error, context.correlationId, context.requestId);
      }
      throw error;
    }
  }, options);
}
