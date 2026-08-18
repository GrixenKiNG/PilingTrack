import type {NextRequest} from 'next/server';
import {ReadinessCommandError} from '@/modules/readiness/application/command-pipeline/errors';
import {updateWorkPermitCommand} from '@/modules/readiness/application/permits/commands';
import {queryWorkPermit} from '@/modules/readiness/application/permits/queries';
import {updateWorkPermitSchema} from '@/modules/readiness/application/permits/schemas';
import {withReadinessRequestTransaction, withReadinessSerializableTransaction} from '@/modules/readiness/infrastructure/tenant-transaction';
import {resolveReadinessRequestContext} from '../../_shared/request-context';
import {readinessErrorResponse, readinessResponse} from '../../_shared/response';
import {withReadinessCommand} from '../../_shared/route-adapter';
import {withApi} from '@/core/api-wrapper';

type Params = {params: Promise<{id: string}>};

async function handleGet(request: NextRequest, {params}: Params) {
  const resolved = await resolveReadinessRequestContext(request);
  if (resolved.response) return resolved.response;
  const context = resolved.context;
  try {
    const {id} = await params;
    const data = await withReadinessRequestTransaction(context.tenantId,
      (tx) => queryWorkPermit(tx, context.tenantId, id));
    return readinessResponse({body: {data, meta: {correlationId: context.correlationId}}, status: 200,
      headers: {ETag: `"work-permit-${id}-v${data.version}"`},
      correlationId: context.correlationId, requestId: context.requestId});
  } catch (error) {
    if (error instanceof ReadinessCommandError) return readinessErrorResponse(error, context.correlationId, context.requestId);
    throw error;
  }
}

export const PATCH = withReadinessCommand(async (request, context, {params}: Params) => {
  const {id} = await params;
  let body: unknown;
  try { body = await request.json(); } catch { throw new ReadinessCommandError('VALIDATION_ERROR', 400, 'Тело запроса должно быть в формате JSON'); }
  const parsed = updateWorkPermitSchema.safeParse(body);
  if (!parsed.success) throw new ReadinessCommandError('VALIDATION_ERROR', 422, 'Некорректные изменения наряда', {fieldErrors: parsed.error.flatten().fieldErrors});
  const result = await withReadinessSerializableTransaction(context.tenantId,
    (tx) => updateWorkPermitCommand({tx, context, id,
      key: request.headers.get('idempotency-key'), ifMatch: request.headers.get('if-match'), payload: parsed.data}));
  return readinessResponse({body: result.body, status: result.status, headers: result.headers,
    correlationId: context.correlationId, requestId: context.requestId});
}, {domain: 'readiness-permits'});

export const GET = withApi(handleGet, {domain: 'readiness-work-permits'});
