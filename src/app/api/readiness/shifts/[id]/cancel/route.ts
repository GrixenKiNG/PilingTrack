import {ReadinessCommandError} from '@/modules/readiness/application/command-pipeline/errors';
import type {NextRequest} from 'next/server';
import {cancelShiftCommand} from '@/modules/readiness/application/shifts/commands';
import {cancelShiftSchema} from '@/modules/readiness/application/shifts/schemas';
import {withReadinessSerializableTransaction} from '@/modules/readiness/infrastructure/tenant-transaction';
import {readinessResponse} from '../../../_shared/response'; import {withReadinessCommand} from '../../../_shared/route-adapter';
export const runtime = 'nodejs';
type Params = {params: Promise<{id: string}>};
export const POST = withReadinessCommand(async (request: NextRequest, context, {params}: Params) => { const {id} = await params;
  const parsed = cancelShiftSchema.safeParse(await request.json()); if (!parsed.success) throw new ReadinessCommandError('VALIDATION_ERROR', 422, 'Invalid cancel command');
  const result = await withReadinessSerializableTransaction(context.tenantId, (tx) => cancelShiftCommand({tx, context, id,
    key: request.headers.get('idempotency-key'), ifMatch: request.headers.get('if-match'), ...parsed.data}));
  return readinessResponse({body: result.body, status: result.status, headers: result.headers, correlationId: context.correlationId, requestId: context.requestId});
}, {domain: 'readiness-shifts'});
