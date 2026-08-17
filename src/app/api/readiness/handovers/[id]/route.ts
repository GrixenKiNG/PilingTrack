import type {NextRequest} from 'next/server';
import {ReadinessCommandError} from '@/modules/readiness/application/command-pipeline/errors';
import {queryHandover} from '@/modules/readiness/application/shifts/queries';
import {withReadinessRequestTransaction} from '@/modules/readiness/infrastructure/tenant-transaction';
import {resolveReadinessRequestContext} from '../../_shared/request-context'; import {readinessErrorResponse, readinessResponse} from '../../_shared/response';
export const runtime = 'nodejs';
export async function GET(request: NextRequest, route: {params: Promise<{id: string}>}) { const resolved = await resolveReadinessRequestContext(request);
  if (resolved.response) return resolved.response; const context = resolved.context;
  try { const {id} = await route.params; const data = await withReadinessRequestTransaction(context.tenantId, (tx) => queryHandover(tx, context.tenantId, id));
    return readinessResponse({body: {data}, status: 200, headers: {ETag: `"handover-${id}-v${data.version}"`}, correlationId: context.correlationId, requestId: context.requestId});
  } catch (error) { if (error instanceof ReadinessCommandError) return readinessErrorResponse(error, context.correlationId, context.requestId); throw error; }}
