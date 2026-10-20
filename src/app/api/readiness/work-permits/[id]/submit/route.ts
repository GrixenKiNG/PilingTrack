import type {NextRequest} from 'next/server';
import {ReadinessCommandError} from '@/modules/readiness/server';
import {submitWorkPermitCommand} from '@/modules/readiness/server';
import {versionedCommandSchema} from '@/modules/readiness/server';
import {withReadinessSerializableTransaction} from '@/modules/readiness/server';
import {withReadinessCommand} from '../../../_shared/route-adapter';
import {readinessResponse} from '../../../_shared/response';

type Params = {params: Promise<{id: string}>};

export const POST = withReadinessCommand(async (request: NextRequest, context, {params}: Params) => {
  const {id} = await params;
  let body: unknown;
  try { body = await request.json(); } catch { throw new ReadinessCommandError('VALIDATION_ERROR', 400, 'Тело запроса должно быть в формате JSON'); }
  const parsed = versionedCommandSchema.safeParse(body);
  if (!parsed.success) throw new ReadinessCommandError('VALIDATION_ERROR', 422, 'Некорректные данные отправки', {fieldErrors: parsed.error.flatten().fieldErrors});
  const result = await withReadinessSerializableTransaction(context.tenantId,
    (tx) => submitWorkPermitCommand({tx, context, id,
      key: request.headers.get('idempotency-key'), ifMatch: request.headers.get('if-match'),
      expectedVersion: parsed.data.expectedVersion}));
  return readinessResponse({body: result.body, status: result.status, headers: result.headers,
    correlationId: context.correlationId, requestId: context.requestId});
}, {domain: 'readiness-permits'});
