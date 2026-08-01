import {NextResponse} from 'next/server';
import {ReadinessCommandError} from '@/modules/readiness/application/command-pipeline/errors';

export function readinessResponse(input: {
  body: unknown;
  status: number;
  correlationId: string;
  requestId: string;
  headers?: Record<string, string>;
}): NextResponse {
  return NextResponse.json(input.body, {
    status: input.status,
    headers: {
      ...input.headers,
      'X-Correlation-Id': input.correlationId,
      'X-Request-Id': input.requestId,
    },
  });
}

export function readinessErrorResponse(
  error: ReadinessCommandError,
  correlationId: string,
  requestId: string,
): NextResponse {
  return readinessResponse({
    status: error.status,
    correlationId,
    requestId,
    headers: error.headers,
    body: {
      error: {
        code: error.code,
        message: error.message,
        details: error.details ?? {},
        correlationId,
      },
    },
  });
}
