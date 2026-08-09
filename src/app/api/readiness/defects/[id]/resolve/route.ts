import type {NextRequest} from 'next/server';
import {ReadinessCommandError} from '@/modules/readiness/application/command-pipeline/errors';
import {resolveDefectCommand} from '@/modules/readiness/application/defects/commands';
import {resolveDefectSchema} from '@/modules/readiness/application/defects/schemas';
import {withReadinessSerializableTransaction} from '@/modules/readiness/infrastructure/tenant-transaction';
import {withReadinessCommand} from '../../../_shared/route-adapter';
import {readinessResponse} from '../../../_shared/response';

type Params = {params: Promise<{id: string}>};

export const POST = withReadinessCommand(async (request: NextRequest, context, {params}: Params) => {
  const {id} = await params;
  let body: unknown;
  try { body = await request.json(); } catch { throw new ReadinessCommandError('VALIDATION_ERROR', 400, 'Тело запроса должно быть в формате JSON'); }
  const parsed = resolveDefectSchema.safeParse(body);
  if (!parsed.success) throw new ReadinessCommandError('VALIDATION_ERROR', 422, 'Некорректные данные устранения', {fieldErrors: parsed.error.flatten().fieldErrors});
  const result = await withReadinessSerializableTransaction(context.tenantId,
    (tx) => resolveDefectCommand({tx, context, id,
      key: request.headers.get('idempotency-key'), ifMatch: request.headers.get('if-match'),
      payload: parsed.data}));
  return readinessResponse({body: result.body, status: result.status, headers: result.headers,
    correlationId: context.correlationId, requestId: context.requestId});
}, {domain: 'readiness-defects', rateLimit: {maxAttempts: 20, windowMs: 60_000, blockDurationMs: 60_000}});
