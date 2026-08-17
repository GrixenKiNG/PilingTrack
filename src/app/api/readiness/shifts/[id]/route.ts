import type {NextRequest} from 'next/server';
import {ReadinessCommandError} from '@/modules/readiness/application/command-pipeline/errors';
import {updateShiftCommand} from '@/modules/readiness/application/shifts/commands';
import {queryShift} from '@/modules/readiness/application/shifts/queries';
import {updateShiftSchema} from '@/modules/readiness/application/shifts/schemas';
import {withReadinessRequestTransaction, withReadinessSerializableTransaction} from '@/modules/readiness/infrastructure/tenant-transaction';
import {resolveReadinessRequestContext} from '../../_shared/request-context';
import {readinessErrorResponse, readinessResponse} from '../../_shared/response';
import {withReadinessCommand} from '../../_shared/route-adapter';

export const runtime = 'nodejs';
type Params = {params: Promise<{id: string}>};
export async function GET(request: NextRequest, route: {params: Promise<{id: string}>}) {
  const resolved = await resolveReadinessRequestContext(request); if (resolved.response) return resolved.response;
  const context = resolved.context;
  try { const {id} = await route.params; const data = await withReadinessRequestTransaction(context.tenantId,
      (tx) => queryShift(tx, context.tenantId, id));
    return readinessResponse({body: {data}, status: 200, headers: {ETag: `"shift-${id}-v${data.version}"`},
      correlationId: context.correlationId, requestId: context.requestId});
  } catch (error) { if (error instanceof ReadinessCommandError) return readinessErrorResponse(error, context.correlationId, context.requestId); throw error; }
}
export const PATCH = withReadinessCommand(async (request: NextRequest, context, {params}: Params) => { const {id} = await params;
  const parsed = updateShiftSchema.safeParse(await request.json());
  if (!parsed.success) throw new ReadinessCommandError('VALIDATION_ERROR', 422, 'Некорректные изменения смены', {fieldErrors: parsed.error.flatten().fieldErrors});
  const result = await withReadinessSerializableTransaction(context.tenantId, (tx) => updateShiftCommand({tx, context, id,
    key: request.headers.get('idempotency-key'), ifMatch: request.headers.get('if-match'), payload: parsed.data}));
  return readinessResponse({body: result.body, status: result.status, headers: result.headers,
    correlationId: context.correlationId, requestId: context.requestId});
}, {domain: 'readiness-shifts'});
