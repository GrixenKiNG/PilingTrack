import type {OfflineAttachment, OperatorAttachmentStore} from './attachment-store';
import {assertSafeOperatorRoute, commandRequestBody, type OfflineCommandEnvelope} from './command-envelope';
import type {OperatorCommandQueue} from './command-queue';

export type QueueTransportResult =
  | {kind: 'confirmed'; confirmedAttachmentIds: string[]; workplace?: unknown}
  | {kind: 'conflict'; code: string; message: string}
  | {kind: 'retry'; code: string; message: string; retryAfterMs?: number};

export interface QueueTransport {send(envelope: OfflineCommandEnvelope, attachments: OfflineAttachment[], signal?: AbortSignal): Promise<QueueTransportResult>;}
export interface ConfirmedCommand {commandId: string; workplace?: unknown;}
export interface SynchronizationReport {confirmed: number; conflicts: number; deferred: number; remaining: number; confirmedCommands: ConfirmedCommand[];}

function messageFromBody(body: unknown, fallback: string): string {
  return body && typeof body === 'object' && typeof (body as {message?: unknown}).message === 'string' ? (body as {message: string}).message : fallback;
}
function codeFromBody(body: unknown, fallback: string): string {
  return body && typeof body === 'object' && typeof (body as {code?: unknown}).code === 'string' ? (body as {code: string}).code : fallback;
}
function confirmedIdsFromBody(body: unknown): string[] {
  if (!body || typeof body !== 'object') return [];
  const top = (body as {confirmedAttachmentIds?: unknown}).confirmedAttachmentIds;
  const nested = (body as {data?: {confirmedAttachmentIds?: unknown}}).data?.confirmedAttachmentIds;
  const value = Array.isArray(top) ? top : nested;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
function workplaceFromBody(body: unknown): unknown {
  if (!body || typeof body !== 'object') return undefined;
  return (body as {workplace?: unknown; data?: {workplace?: unknown}}).workplace
    ?? (body as {data?: {workplace?: unknown}}).data?.workplace;
}

export function createFetchQueueTransport(fetcher?: typeof fetch): QueueTransport {
  const sendRequest: typeof fetch = fetcher ?? ((input, init) => globalThis.fetch(input, init));
  return {
    async send(envelope, attachments, signal) {
      const route = attachments.length > 0 ? '/api/operator/v3/sync' : assertSafeOperatorRoute(envelope.route);
      const headers: Record<string, string> = {accept: 'application/json', 'Idempotency-Key': envelope.commandId, 'If-Match': `v${envelope.expectedVersion}`};
      let body: BodyInit;
      if (attachments.length > 0) {
        const form = new FormData();
        form.append('command', commandRequestBody(envelope));
        for (const attachment of attachments) form.append('attachments', attachment.content, attachment.name);
        body = form;
      } else {
        headers['Content-Type'] = 'application/json';
        body = commandRequestBody(envelope);
      }
      const response = await sendRequest(route, {method: 'POST', credentials: 'same-origin', headers, body, signal});
      const responseBody = await response.json().catch(() => null) as unknown;
      if (response.ok) return {kind: 'confirmed', confirmedAttachmentIds: confirmedIdsFromBody(responseBody), workplace: workplaceFromBody(responseBody)};
      const permanentClientError = response.status >= 400 && response.status < 500 && ![401, 403, 408, 429].includes(response.status);
      if (response.status === 409 || response.status === 412 || permanentClientError) {
        return {kind: 'conflict', code: codeFromBody(responseBody, 'КОНФЛИКТ_КОМАНДЫ'), message: messageFromBody(responseBody, 'Команда требует проверки')};
      }
      const retryHeader = response.headers.get('retry-after');
      const retryAfterMs = retryHeader && /^\d+$/u.test(retryHeader) ? Number(retryHeader) * 1000 : undefined;
      return {kind: 'retry', code: codeFromBody(responseBody, 'ОШИБКА_СИНХРОНИЗАЦИИ'), message: messageFromBody(responseBody, 'Синхронизация временно недоступна'), ...(retryAfterMs ? {retryAfterMs} : {})};
    },
  };
}

export class OperatorQueueSynchronizer {
  private active: Promise<SynchronizationReport> | null = null;
  private readonly workerId: string;

  constructor(private readonly queue: OperatorCommandQueue, private readonly attachments: OperatorAttachmentStore, private readonly transport: QueueTransport) {
    if (!globalThis.crypto?.randomUUID) throw new Error('Не удалось создать идентификатор синхронизации');
    this.workerId = globalThis.crypto.randomUUID();
  }

  synchronize(signal?: AbortSignal, limit = 50): Promise<SynchronizationReport> {
    if (!this.active) this.active = this.run(signal, limit).finally(() => { this.active = null; });
    return this.active;
  }

  private async run(signal: AbortSignal | undefined, limit: number): Promise<SynchronizationReport> {
    const report: SynchronizationReport = {confirmed: 0, conflicts: 0, deferred: 0, remaining: 0, confirmedCommands: []};
    for (let index = 0; index < limit && !signal?.aborted; index += 1) {
      const command = await this.queue.claimNext(this.workerId);
      if (!command) break;
      const commandAttachments = command.envelope.attachmentIds.length === 0
        ? []
        : await this.attachments.listForCommand(command.envelope.commandId);
      try {
        const result = await this.transport.send(command.envelope, commandAttachments.filter((attachment) => !attachment.serverConfirmed), signal);
        if (result.kind === 'conflict') {
          await this.queue.markConflict(command.envelope.commandId, this.workerId, result.code, result.message);
          report.conflicts += 1;
          continue;
        }
        if (result.kind === 'retry') {
          await this.queue.markFailed(command.envelope.commandId, this.workerId, result.code, result.message, Date.now() + (result.retryAfterMs ?? 5_000));
          report.deferred += 1;
          continue;
        }
        await this.attachments.confirmServerAcceptance(command.envelope.commandId, result.confirmedAttachmentIds);
        if (!await this.attachments.areAllServerConfirmed(command.envelope.commandId, command.envelope.attachmentIds)) {
          await this.queue.markFailed(command.envelope.commandId, this.workerId, 'ВЛОЖЕНИЕ_НЕ_ПОДТВЕРЖДЕНО', 'Сервер не подтвердил получение всех вложений', Date.now() + 5_000);
          report.deferred += 1;
          continue;
        }
        if (await this.queue.removeConfirmed(command.envelope.commandId, this.workerId)) {
          await this.attachments.removeConfirmedForCommand(command.envelope.commandId);
          report.confirmed += 1;
          report.confirmedCommands.push({commandId: command.envelope.commandId, ...(result.workplace === undefined ? {} : {workplace: result.workplace})});
        }
      } catch (error) {
        if (signal?.aborted) {
          await this.queue.release(command.envelope.commandId, this.workerId);
          break;
        }
        await this.queue.markFailed(command.envelope.commandId, this.workerId, 'СЕТЕВАЯ_ОШИБКА', error instanceof Error ? error.message : 'Синхронизация временно недоступна', Date.now() + 5_000);
        report.deferred += 1;
      }
    }
    report.remaining = (await this.queue.summary()).total;
    return report;
  }
}
