const SAFE_ROUTE = /^\/api\/operator\/v3\/(?:commands|sync)(?:\/|$)[a-z0-9/_-]*$/u;

export interface OfflineCommandEnvelope {
  commandId: string;
  route: string;
  method: 'POST';
  expectedVersion: number;
  deviceId: string;
  deviceSequence: number;
  occurredAt: string;
  payload: Record<string, unknown>;
  aggregateId?: string;
  attachmentIds: string[];
}

export interface CreateOfflineCommandInput extends Omit<OfflineCommandEnvelope, 'commandId' | 'method' | 'attachmentIds'> {
  commandId?: string;
  attachmentIds?: string[];
}

export function createOfflineCommandId(): string {
  if (!globalThis.crypto?.randomUUID) throw new Error('Не удалось создать безопасный идентификатор команды');
  return globalThis.crypto.randomUUID();
}

export function assertSafeOperatorRoute(route: string): string {
  if (!SAFE_ROUTE.test(route)) throw new TypeError('Команду можно отправлять только в защищённый маршрут модуля оператора');
  return route;
}

function assertText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`Не заполнено поле «${label}»`);
  return normalized;
}

export function createOfflineCommandEnvelope(input: CreateOfflineCommandInput): OfflineCommandEnvelope {
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 0) throw new TypeError('Некорректная версия рабочего места');
  if (!Number.isInteger(input.deviceSequence) || input.deviceSequence <= 0) throw new TypeError('Некорректный номер команды устройства');
  const occurredAt = new Date(input.occurredAt);
  if (Number.isNaN(occurredAt.valueOf())) throw new TypeError('Некорректное время команды');
  const commandId = assertText(input.commandId ?? createOfflineCommandId(), 'Идентификатор команды');
  const attachmentIds = [...new Set(input.attachmentIds ?? [])];
  return {
    commandId,
    route: assertSafeOperatorRoute(input.route),
    method: 'POST',
    expectedVersion: input.expectedVersion,
    deviceId: assertText(input.deviceId, 'Устройство'),
    deviceSequence: input.deviceSequence,
    occurredAt: occurredAt.toISOString(),
    payload: structuredClone(input.payload),
    ...(input.aggregateId ? {aggregateId: input.aggregateId} : {}),
    attachmentIds,
  };
}

export function commandRequestBody(envelope: OfflineCommandEnvelope): string {
  return JSON.stringify({
    commandId: envelope.commandId,
    deviceId: envelope.deviceId,
    deviceSequence: envelope.deviceSequence,
    occurredAt: envelope.occurredAt,
    expectedVersion: envelope.expectedVersion,
    payload: envelope.payload,
    ...(envelope.aggregateId ? {aggregateId: envelope.aggregateId} : {}),
  });
}
