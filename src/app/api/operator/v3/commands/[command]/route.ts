import {NextResponse, type NextRequest} from 'next/server';
import {queryOperatorWorkplace} from '@/modules/operator-v3';
import {executeOperatorCommand} from '@/modules/operator-v3/application/commands/execute-operator-command';
import {createExistingOperatorCommandRegistry} from '@/modules/operator-v3/application/commands/existing-command-adapters';
import {OperatorCommandError} from '@/modules/operator-v3/application/commands/operator-command-errors';
import {isOperatorV3CommandName} from '@/modules/operator-v3/application/commands/operator-command-registry';
import {PrismaCommandIdempotencyRepository} from '@/modules/readiness/infrastructure/command-pipeline/idempotency-repository';
import {withReadinessSerializableTransaction} from '@/modules/readiness/infrastructure/tenant-transaction';
import {withOperatorV3Command} from '../../_shared/command-route';

export const runtime = 'nodejs';
type Params = {params: Promise<{command: string}>};

async function body(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new OperatorCommandError('VALIDATION_ERROR', 422, 'Тело запроса должно быть в формате JSON');
  }
}

export const POST = withOperatorV3Command(async (request, context, {params}: Params) => {
  const {command} = await params;
  if (!isOperatorV3CommandName(command)) {
    throw new OperatorCommandError('NOT_FOUND', 404, 'Запрошенное действие не существует или больше недоступно');
  }
  const envelope = await body(request);
  const receipt = await withReadinessSerializableTransaction(context.tenantId, async (tx) =>
    executeOperatorCommand({
      commandName: command,
      envelope,
      idempotencyKey: request.headers.get('idempotency-key'),
      ifMatch: request.headers.get('if-match'),
      context,
      repository: new PrismaCommandIdempotencyRepository(tx),
      registry: createExistingOperatorCommandRegistry(tx),
      readWorkplace: async () => null,
    }));
  const workplace = await queryOperatorWorkplace({
    tenantId: context.tenantId,
    operatorId: context.actorId,
    operatorName: context.actorName,
  });
  return NextResponse.json({...receipt, workplace}, {
    status: 200,
    headers: {
      'X-Correlation-Id': context.correlationId,
      'X-Request-Id': context.requestId,
    },
  });
}, {domain: 'operator-v3-commands', rateLimit: {maxAttempts: 30, windowMs: 60_000, blockDurationMs: 60_000}});

