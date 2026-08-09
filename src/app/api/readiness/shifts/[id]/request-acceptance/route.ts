import type {NextRequest} from 'next/server';
import {requestShiftAcceptanceCommand} from '@/modules/readiness/application/shifts/commands';
import {withReadinessSerializableTransaction} from '@/modules/readiness/infrastructure/tenant-transaction';
import {readinessResponse} from '../../../_shared/response';
import {withReadinessCommand} from '../../../_shared/route-adapter';
export const runtime = 'nodejs';
type Params = {params: Promise<{id: string}>};
export const POST = withReadinessCommand(async (request: NextRequest, context, {params}: Params) => {
  const {id} = await params;
  const body = await request.json().catch(() => ({}));
  const result = await withReadinessSerializableTransaction(context.tenantId, (tx) =>
    requestShiftAcceptanceCommand({tx, context, id, key: request.headers.get('idempotency-key'),
      ifMatch: request.headers.get('if-match'), expectedVersion: (body as {expectedVersion?: number}).expectedVersion}));
  return readinessResponse({body: result.body, status: result.status, headers: result.headers,
    correlationId: context.correlationId, requestId: context.requestId});
}, {domain: 'readiness-shifts'});
