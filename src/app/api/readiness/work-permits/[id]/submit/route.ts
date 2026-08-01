import type {NextRequest} from 'next/server';
import {ReadinessCommandError} from '@/modules/readiness/application/command-pipeline/errors';
import {submitWorkPermitCommand} from '@/modules/readiness/application/permits/commands';
import {versionedCommandSchema} from '@/modules/readiness/application/permits/schemas';
import {withReadinessSerializableTransaction} from '@/modules/readiness/infrastructure/tenant-transaction';
import {withReadinessCommand} from '../../../_shared/route-adapter';
import {readinessResponse} from '../../../_shared/response';

type Params = {params: Promise<{id: string}>};

export const POST = withReadinessCommand(async (request: NextRequest, context, {params}: Params) => {
  const {id} = await params;
  let body: unknown;
  try { body = await request.json(); } catch { throw new ReadinessCommandError('VALIDATION_ERROR', 400, 'Request body must be JSON'); }
  const parsed = versionedCommandSchema.safeParse(body);
  if (!parsed.success) throw new ReadinessCommandError('VALIDATION_ERROR', 422, 'Invalid submit command', {fieldErrors: parsed.error.flatten().fieldErrors});
  const result = await withReadinessSerializableTransaction(context.tenantId,
    (tx) => submitWorkPermitCommand({tx, context, id,
      key: request.headers.get('idempotency-key'), ifMatch: request.headers.get('if-match'),
      expectedVersion: parsed.data.expectedVersion}));
  return readinessResponse({body: result.body, status: result.status, headers: result.headers,
    correlationId: context.correlationId, requestId: context.requestId});
}, {domain: 'readiness-permits'});
