import type {NextRequest} from 'next/server';
import {ReadinessCommandError} from '@/modules/readiness/application/command-pipeline/errors';
import {createShiftCommand} from '@/modules/readiness/application/shifts/commands';
import {queryShifts} from '@/modules/readiness/application/shifts/queries';
import {createShiftSchema} from '@/modules/readiness/application/shifts/schemas';
import {withReadinessRequestTransaction, withReadinessSerializableTransaction} from '@/modules/readiness/infrastructure/tenant-transaction';
import {resolveReadinessRequestContext} from '../_shared/request-context';
import {readinessErrorResponse, readinessResponse} from '../_shared/response';
import {withReadinessCommand} from '../_shared/route-adapter';

export const runtime = 'nodejs';
const json = async (request: NextRequest) => { try { return await request.json(); }
  catch { throw new ReadinessCommandError('VALIDATION_ERROR', 400, 'Request body must be JSON'); }};

export async function GET(request: NextRequest) {
  const resolved = await resolveReadinessRequestContext(request); if (resolved.response) return resolved.response;
  const context = resolved.context!;
  try { const p = request.nextUrl.searchParams; const allowed = new Set(['equipmentId', 'state', 'type', 'limit']);
    if ([...p.keys()].some((key) => !allowed.has(key))) throw new ReadinessCommandError('VALIDATION_ERROR', 400, 'Unknown shift filter');
    const limit = p.has('limit') ? Number(p.get('limit')) : 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new ReadinessCommandError('VALIDATION_ERROR', 400, 'Invalid limit');
    const state = p.get('state'); const type = p.get('type');
    if (state && !['PLANNED', 'STARTED', 'HANDOVER_PENDING', 'CLOSED', 'CANCELLED'].includes(state))
      throw new ReadinessCommandError('VALIDATION_ERROR', 400, 'Invalid shift state');
    if (type && !['DAY', 'NIGHT'].includes(type)) throw new ReadinessCommandError('VALIDATION_ERROR', 400, 'Invalid shift type');
    const result = await withReadinessRequestTransaction(context.tenantId, (tx) => queryShifts(tx, {tenantId: context.tenantId,
      equipmentId: p.get('equipmentId') ?? undefined, state: state as never, type: type as never, limit}));
    return readinessResponse({body: result, status: 200, correlationId: context.correlationId, requestId: context.requestId});
  } catch (error) { if (error instanceof ReadinessCommandError) return readinessErrorResponse(error, context.correlationId, context.requestId); throw error; }
}

export const POST = withReadinessCommand(async (request, context) => {
  const parsed = createShiftSchema.safeParse(await json(request));
  if (!parsed.success) throw new ReadinessCommandError('VALIDATION_ERROR', 422, 'Invalid shift', {fieldErrors: parsed.error.flatten().fieldErrors});
  const result = await withReadinessSerializableTransaction(context.tenantId, (tx) => createShiftCommand({tx, context,
    key: request.headers.get('idempotency-key'), payload: parsed.data}));
  return readinessResponse({body: result.body, status: result.status, headers: result.headers,
    correlationId: context.correlationId, requestId: context.requestId});
}, {domain: 'readiness-shifts'});
