import {ReadinessCommandError} from '@/modules/readiness/application/command-pipeline/errors';
import type {NextRequest} from 'next/server';
import {reworkHandoverCommand} from '@/modules/readiness/application/shifts/commands'; import {reworkHandoverSchema} from '@/modules/readiness/application/shifts/schemas';
import {withReadinessSerializableTransaction} from '@/modules/readiness/infrastructure/tenant-transaction'; import {readinessResponse} from '../../../_shared/response'; import {withReadinessCommand} from '../../../_shared/route-adapter';
import { readJsonBody } from '@/core/api-wrapper';

export const runtime = 'nodejs';
type Params = {params: Promise<{id: string}>};
export const POST = withReadinessCommand(async (request: NextRequest, context, {params}: Params) => { const {id} = await params; const parsed = reworkHandoverSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw new ReadinessCommandError('VALIDATION_ERROR', 422, 'Некорректные данные возврата');
  const result = await withReadinessSerializableTransaction(context.tenantId, (tx) => reworkHandoverCommand({tx, context, id,
    key: request.headers.get('idempotency-key'), ifMatch: request.headers.get('if-match'), expectedVersion: parsed.data.expectedVersion, reason: parsed.data.reason}));
  return readinessResponse({body: result.body, status: result.status, headers: result.headers, correlationId: context.correlationId, requestId: context.requestId});
}, {domain: 'readiness-handovers'});
