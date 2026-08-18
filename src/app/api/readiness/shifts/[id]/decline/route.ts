import {ReadinessCommandError} from '@/modules/readiness/application/command-pipeline/errors';
import type {NextRequest} from 'next/server';
import {declineShiftCommand} from '@/modules/readiness/application/shifts/commands';
import {declineShiftSchema} from '@/modules/readiness/application/shifts/schemas';
import {withReadinessSerializableTransaction} from '@/modules/readiness/infrastructure/tenant-transaction';
import {readinessResponse} from '../../../_shared/response';
import {withReadinessCommand} from '../../../_shared/route-adapter';
import { readJsonBody } from '@/core/api-wrapper';

export const runtime = 'nodejs';
type Params = {params: Promise<{id: string}>};
export const POST = withReadinessCommand(async (request: NextRequest, context, {params}: Params) => {
  const {id} = await params;
  const parsed = declineShiftSchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw new ReadinessCommandError('VALIDATION_ERROR', 422, 'Некорректные данные отказа');
  const result = await withReadinessSerializableTransaction(context.tenantId, (tx) =>
    declineShiftCommand({tx, context, id, key: request.headers.get('idempotency-key'),
      ifMatch: request.headers.get('if-match'), expectedVersion: parsed.data.expectedVersion,
      reason: parsed.data.reason}));
  return readinessResponse({body: result.body, status: result.status, headers: result.headers,
    correlationId: context.correlationId, requestId: context.requestId});
}, {domain: 'readiness-shifts'});
