import {describe, expect, it, vi} from 'vitest';
import type {CommandIdempotencyRepository, StoredCommandResult} from '@/modules/readiness/application/command-pipeline/execute-command';
import {OperatorCommandError} from '../operator-command-errors';
import {executeOperatorCommand} from '../execute-operator-command';

class MemoryReceiptRepository implements CommandIdempotencyRepository {
  private value: StoredCommandResult | null = null;

  async tryClaim(input: {requestHash: Uint8Array}): Promise<boolean> {
    if (this.value) return false;
    this.value = {status: 'processing', requestHash: input.requestHash, statusCode: null, result: null, responseHeaders: null};
    return true;
  }

  async find(): Promise<StoredCommandResult | null> {
    return this.value;
  }

  async complete(input: {statusCode: number; result: unknown; responseHeaders: Record<string, string>}): Promise<void> {
    if (!this.value) throw new Error('Квитанция не захвачена');
    this.value = {...this.value, status: 'completed', statusCode: input.statusCode, result: input.result, responseHeaders: input.responseHeaders};
  }
}

const envelope = {
  commandId: 'operator-command-0001',
  aggregateId: 'assignment-1',
  expectedVersion: 4,
  deviceId: 'operator-tablet-1',
  deviceSequence: 12,
  occurredAt: '2026-08-27T08:00:00.000Z',
  payload: {assignmentId: 'assignment-1'},
};

const context = {
  tenantId: 'tenant-1', actorId: 'operator-1', actorName: 'Иванов И.И.', actorRole: 'OPERATOR',
  requestId: 'request-1', correlationId: 'correlation-1',
};

describe('executeOperatorCommand', () => {
  it('выполняет зарегистрированную команду один раз и при повторе возвращает исходную квитанцию', async () => {
    const repository = new MemoryReceiptRepository();
    const adapter = vi.fn().mockResolvedValue({newVersion: 5, createdEvents: ['назначение.принято']});
    const registry = new Map([['accept-assignment', {critical: false, execute: adapter}]]);
    const workplace = vi.fn().mockResolvedValue({revision: '5'});

    const first = await executeOperatorCommand({
      commandName: 'accept-assignment', envelope, idempotencyKey: envelope.commandId,
      ifMatch: null, context, repository, registry, readWorkplace: workplace,
    });
    const replay = await executeOperatorCommand({
      commandName: 'accept-assignment', envelope, idempotencyKey: envelope.commandId,
      ifMatch: null, context, repository, registry, readWorkplace: workplace,
    });

    expect(adapter).toHaveBeenCalledTimes(1);
    expect(first).toEqual({result: 'COMPLETED', replayed: false, commandId: envelope.commandId,
      newVersion: 5, createdEvents: ['назначение.принято'], workplace: {revision: '5'}});
    expect(replay).toEqual({...first, replayed: true});
  });

  it('отклоняет несовпадение заголовка и commandId', async () => {
    await expect(executeOperatorCommand({
      commandName: 'accept-assignment', envelope, idempotencyKey: 'different-command-id', ifMatch: null,
      context, repository: new MemoryReceiptRepository(), registry: new Map(), readWorkplace: vi.fn(),
    })).rejects.toMatchObject({code: 'VALIDATION_ERROR', status: 422});
  });

  it('отклоняет критическую команду без If-Match', async () => {
    await expect(executeOperatorCommand({
      commandName: 'start-shift', envelope, idempotencyKey: envelope.commandId, ifMatch: null,
      context, repository: new MemoryReceiptRepository(),
      registry: new Map([['start-shift', {critical: true, execute: vi.fn()}]]), readWorkplace: vi.fn(),
    })).rejects.toMatchObject({code: 'VERSION_CONFLICT', status: 409});
  });

  it('принимает сильную метку версии существующего агрегата для критической команды', async () => {
    const adapter = vi.fn().mockResolvedValue({newVersion: 5, createdEvents: ['Смена начата']});
    const result = await executeOperatorCommand({
      commandName: 'start-shift', envelope, idempotencyKey: envelope.commandId,
      ifMatch: '"shift-shift-1-v4"', context, repository: new MemoryReceiptRepository(),
      registry: new Map([['start-shift', {critical: true, execute: adapter}]]),
      readWorkplace: vi.fn().mockResolvedValue({revision: '5'}),
    });
    expect(result.newVersion).toBe(5);
    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it('не запускает адаптер второй раз при повторе ключа с другим содержимым', async () => {
    const repository = new MemoryReceiptRepository();
    const adapter = vi.fn().mockResolvedValue({newVersion: 5, createdEvents: []});
    const registry = new Map([['accept-assignment', {critical: false, execute: adapter}]]);
    const base = {commandName: 'accept-assignment', idempotencyKey: envelope.commandId, ifMatch: null,
      context, repository, registry, readWorkplace: vi.fn().mockResolvedValue({revision: '5'})};
    await executeOperatorCommand({...base, envelope});
    await expect(executeOperatorCommand({...base, envelope: {...envelope, payload: {assignmentId: 'assignment-2'}}}))
      .rejects.toMatchObject({code: 'IDEMPOTENCY_KEY_REUSED', status: 409});
    expect(adapter).toHaveBeenCalledTimes(1);
  });

  it('запрещает незарегистрированный маршрут команды', async () => {
    await expect(executeOperatorCommand({
      commandName: 'client-invented', envelope, idempotencyKey: envelope.commandId, ifMatch: null,
      context, repository: new MemoryReceiptRepository(), registry: new Map(), readWorkplace: vi.fn(),
    })).rejects.toBeInstanceOf(OperatorCommandError);
  });

  it('отклоняет некорректный payload новой команды до запуска адаптера', async () => {
    const adapter = vi.fn();
    await expect(executeOperatorCommand({
      commandName: 'capture-weather', envelope: {...envelope, payload: {}},
      idempotencyKey: envelope.commandId, ifMatch: null, context,
      repository: new MemoryReceiptRepository(),
      registry: new Map([['capture-weather', {critical: false, execute: adapter}]]),
      readWorkplace: vi.fn(),
    })).rejects.toMatchObject({code: 'VALIDATION_ERROR', status: 422});
    expect(adapter).not.toHaveBeenCalled();
  });
});
