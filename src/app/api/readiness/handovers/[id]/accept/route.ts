import {ReadinessCommandError} from '@/modules/readiness/application/command-pipeline/errors';
import type {NextRequest} from 'next/server';
import {acceptHandoverCommand} from '@/modules/readiness/application/shifts/commands'; import {acceptHandoverSchema} from '@/modules/readiness/application/shifts/schemas';
import {HandoverRepository} from '@/modules/readiness/infrastructure/shifts/handover-repository';
import {withReadinessSerializableTransaction, withReadinessTenantTransaction} from '@/modules/readiness/infrastructure/tenant-transaction'; import {readinessResponse} from '../../../_shared/response'; import {withReadinessCommand} from '../../../_shared/route-adapter';
export const runtime = 'nodejs';
type Params = {params: Promise<{id: string}>};
export const POST = withReadinessCommand(async (request: NextRequest, context, {params}: Params) => { const {id} = await params; const parsed = acceptHandoverSchema.safeParse(await request.json());
  if (!parsed.success) throw new ReadinessCommandError('VALIDATION_ERROR', 422, 'Invalid accept command');
  const result = await withReadinessSerializableTransaction(context.tenantId, (tx) => acceptHandoverCommand({tx, context, id,
    key: request.headers.get('idempotency-key'), ifMatch: request.headers.get('if-match'), expectedVersion: parsed.data.expectedVersion}), {
    resolveConflictDetails: async () => {
      const current = await withReadinessTenantTransaction(context.tenantId,
        (tx) => new HandoverRepository(tx).safeCurrent(context.tenantId, id));
      return current ? {current} : undefined;
    },
  });
  return readinessResponse({body: result.body, status: result.status, headers: result.headers, correlationId: context.correlationId, requestId: context.requestId});
}, {domain: 'readiness-handovers', rateLimit: {maxAttempts: 20, windowMs: 60_000, blockDurationMs: 60_000}});
