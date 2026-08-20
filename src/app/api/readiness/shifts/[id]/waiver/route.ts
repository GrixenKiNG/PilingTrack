import {ReadinessCommandError} from '@/modules/readiness/application/command-pipeline/errors';
import type {NextRequest} from 'next/server';
import {z} from 'zod';
import {waiveShiftStartCommand} from '@/modules/readiness/application/shifts/commands';
import {withReadinessSerializableTransaction} from '@/modules/readiness/infrastructure/tenant-transaction';
import {readinessResponse} from '../../../_shared/response';
import {withReadinessCommand} from '../../../_shared/route-adapter';
import {readJsonBody} from '@/core/api-wrapper';

export const runtime = 'nodejs';
type Params = {params: Promise<{id: string}>};

const schema = z.object({reason: z.string().min(10).max(1000)});

export const POST = withReadinessCommand(async (request: NextRequest, context, {params}: Params) => {
  const {id} = await params;
  const parsed = schema.safeParse(await readJsonBody(request));
  if (!parsed.success) {
    throw new ReadinessCommandError('VALIDATION_ERROR', 422,
      'Причина разрешения: от 10 до 1000 символов — её будут читать при разборе');
  }
  const result = await withReadinessSerializableTransaction(context.tenantId, (tx) =>
    waiveShiftStartCommand({tx, context, id, key: request.headers.get('idempotency-key'),
      reason: parsed.data.reason}));
  return readinessResponse({body: result.body, status: result.status, headers: result.headers,
    correlationId: context.correlationId, requestId: context.requestId});
}, {domain: 'readiness-shifts', rateLimit: {maxAttempts: 10, windowMs: 60_000, blockDurationMs: 60_000}});
