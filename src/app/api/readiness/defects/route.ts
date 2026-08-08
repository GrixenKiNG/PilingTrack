import type {NextRequest} from 'next/server';
import {resolveReadinessCapabilities} from '@/modules/readiness/application/capabilities';
import {ReadinessCommandError} from '@/modules/readiness/application/command-pipeline/errors';
import {createDefectCommand} from '@/modules/readiness/application/defects/commands';
import {queryDefects} from '@/modules/readiness/application/defects/queries';
import {createDefectSchema, listDefectsQuerySchema} from '@/modules/readiness/application/defects/schemas';
import {
  withReadinessRequestTransaction,
  withReadinessSerializableTransaction,
} from '@/modules/readiness/infrastructure/tenant-transaction';
import {resolveReadinessRequestContext} from '../_shared/request-context';
import {readinessErrorResponse, readinessResponse} from '../_shared/response';
import {withReadinessCommand} from '../_shared/route-adapter';

export const runtime = 'nodejs';

const DEFAULT_LIMIT = 50;

export async function GET(request: NextRequest) {
  const {context, response} = await resolveReadinessRequestContext(request);
  // Резолвер возвращает либо готовый отказ, либо контекст: проверяем сам
  // контекст, чтобы не утверждать его наличие восклицательным знаком.
  if (!context) {
    return response ?? readinessErrorResponse(
      new ReadinessCommandError('VALIDATION_ERROR', 403, 'Readiness access denied'),
      'unknown', 'unknown',
    );
  }
  try {
    if (!resolveReadinessCapabilities(context.actorRole).has('readiness.read')) {
      throw new ReadinessCommandError('VALIDATION_ERROR', 403, 'Readiness access denied');
    }
    const parsed = listDefectsQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );
    if (!parsed.success) {
      throw new ReadinessCommandError('VALIDATION_ERROR', 422, 'Invalid defect filters',
        {fieldErrors: parsed.error.flatten().fieldErrors});
    }
    const result = await withReadinessRequestTransaction(context.tenantId, (tx) => queryDefects({
      tx, tenantId: context.tenantId,
      filters: {
        equipmentId: parsed.data.equipmentId,
        status: parsed.data.status,
        severity: parsed.data.severity,
        openOnly: parsed.data.openOnly === 'true',
        limit: parsed.data.limit ?? DEFAULT_LIMIT,
        cursor: parsed.data.cursor,
      },
    }));
    return readinessResponse({
      body: {data: result.data, meta: {total: result.total, nextCursor: result.nextCursor,
        summary: result.summary}},
      status: 200, correlationId: context.correlationId, requestId: context.requestId,
    });
  } catch (error) {
    return readinessErrorResponse(
      error instanceof ReadinessCommandError
        ? error
        : new ReadinessCommandError('RETRYABLE_TRANSACTION_FAILURE', 503, 'Defect list is unavailable'),
      context.correlationId,
      context.requestId,
    );
  }
}

export const POST = withReadinessCommand(async (request: NextRequest, context) => {
  let body: unknown;
  try { body = await request.json(); }
  catch { throw new ReadinessCommandError('VALIDATION_ERROR', 400, 'Request body must be JSON'); }
  const parsed = createDefectSchema.safeParse(body);
  if (!parsed.success) {
    throw new ReadinessCommandError('VALIDATION_ERROR', 422, 'Invalid defect payload',
      {fieldErrors: parsed.error.flatten().fieldErrors});
  }
  const result = await withReadinessSerializableTransaction(context.tenantId,
    (tx) => createDefectCommand({tx, context,
      key: request.headers.get('idempotency-key'), payload: parsed.data}));
  return readinessResponse({body: result.body, status: result.status, headers: result.headers,
    correlationId: context.correlationId, requestId: context.requestId});
}, {domain: 'readiness-defects', rateLimit: {maxAttempts: 30, windowMs: 60_000, blockDurationMs: 60_000}});
