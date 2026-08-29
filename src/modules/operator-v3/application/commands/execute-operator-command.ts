import type {AuditJsonValue} from '@/modules/readiness/domain/audit/types';
import {
  executeIdempotentCommand,
  type CommandIdempotencyRepository,
} from '@/modules/readiness/application/command-pipeline/execute-command';
import {
  createIdempotencyScope,
  hashCommandRequest,
  requireIdempotencyKey,
} from '@/modules/readiness/application/command-pipeline/idempotency';
import {
  operatorCommandChecksum,
  operatorCommandEnvelopeSchemaFor,
  type OperatorCommandEnvelope,
} from './envelope-schema';
import {OperatorCommandError, unknownOperatorCommand} from './operator-command-errors';
import type {OperatorCommandContext, OperatorCommandRegistry} from './operator-command-registry';

export interface OperatorCommandReceipt<TWorkplace = unknown> {
  result: 'COMPLETED';
  replayed: boolean;
  commandId: string;
  newVersion: number;
  createdEvents: string[];
  workplace: TWorkplace;
}

type StoredBusinessReceipt = Omit<OperatorCommandReceipt<never>, 'replayed' | 'workplace'>;

/**
 * Версия из заголовка `if-match`.
 *
 * Принимаем два вида намеренно. Строгий ETag `"shift-<id>-v4"` выдаёт контур
 * готовности, и его команды приходят сюда через адаптеры. Короткий `v4` —
 * формат самого рабочего места версии 3: его маршруты ETag не выдают вовсе,
 * поэтому эхо-ответа у клиента нет и взять полную форму ему неоткуда.
 *
 * Разбор был скопирован из контура готовности вместе с требованием кавычки на
 * конце — и не подходил ни одному из двух отправителей v3. Ни одна критическая
 * команда не проходила: пуск смены, завершение осмотра, отчёт, передача и
 * подтверждение безопасной остановки отвечали 409. Проверки этого не поймали,
 * потому что подавали серверу его же формат, а не тот, что шлёт клиент.
 */
function ifMatchVersion(value: string): number | null {
  const match = /^"?(?:.*-)?v(\d+)"?$/.exec(value.trim());
  return match ? Number(match[1]) : null;
}

export async function executeOperatorCommand<TWorkplace>(input: {
  commandName: string;
  envelope: OperatorCommandEnvelope | unknown;
  idempotencyKey: string | null;
  ifMatch: string | null;
  context: OperatorCommandContext;
  repository: CommandIdempotencyRepository;
  registry: OperatorCommandRegistry;
  readWorkplace(): Promise<TWorkplace>;
}): Promise<OperatorCommandReceipt<TWorkplace>> {
  const parsed = operatorCommandEnvelopeSchemaFor(input.commandName).safeParse(input.envelope);
  if (!parsed.success) {
    throw new OperatorCommandError('VALIDATION_ERROR', 422, 'Некорректные данные команды', {
      fields: parsed.error.flatten().fieldErrors,
      form: parsed.error.flatten().formErrors,
    });
  }
  const envelope = parsed.data as OperatorCommandEnvelope;
  const key = requireIdempotencyKey(input.idempotencyKey);
  if (key !== envelope.commandId) {
    throw new OperatorCommandError(
      'VALIDATION_ERROR', 422,
      'Заголовок повторной отправки не совпадает с идентификатором команды',
    );
  }

  const definition = input.registry.get(input.commandName);
  if (!definition) throw unknownOperatorCommand(input.commandName);

  if (definition.critical) {
    if (!input.ifMatch) {
      throw new OperatorCommandError(
        'VERSION_CONFLICT', 409,
        'Не указана версия данных. Обновите рабочее место и повторите действие',
      );
    }
    const headerVersion = ifMatchVersion(input.ifMatch);
    if (headerVersion === null || headerVersion !== envelope.expectedVersion) {
      throw new OperatorCommandError(
        'VERSION_CONFLICT', 409,
        'Версия в запросе не совпадает с версией рабочего места',
        {expectedVersion: envelope.expectedVersion},
      );
    }
  }

  const scope = createIdempotencyScope({
    method: 'POST',
    routeTemplate: `/api/operator/v3/commands/${input.commandName}`,
    aggregateId: envelope.aggregateId ?? null,
    actorId: input.context.actorId,
  });
  const requestHash = hashCommandRequest({
    method: 'POST',
    routeTemplate: `/api/operator/v3/commands/${input.commandName}`,
    pathIds: envelope.aggregateId ? {aggregateId: envelope.aggregateId} : {},
    body: envelope,
    expectedVersion: envelope.expectedVersion,
    actorId: input.context.actorId,
  });

  const executed = await executeIdempotentCommand({
    repository: input.repository,
    tenantId: input.context.tenantId,
    actorId: input.context.actorId,
    scope,
    key,
    requestHash,
    execute: async () => {
      const result = await definition.execute({
        envelope,
        context: input.context,
        checksum: operatorCommandChecksum(envelope),
      });
      const body: StoredBusinessReceipt = {
        result: 'COMPLETED',
        commandId: envelope.commandId,
        newVersion: result.newVersion,
        createdEvents: result.createdEvents,
      };
      return {status: 200, body: body as unknown as AuditJsonValue};
    },
  });

  const business = executed.body as unknown as StoredBusinessReceipt;
  const workplace = await input.readWorkplace();
  return {...business, replayed: executed.replayed, workplace};
}
