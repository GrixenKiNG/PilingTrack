import {describe, expect, it} from 'vitest';
import {OperatorCommandQueue} from '../command-queue';
import {createMemoryCrossTabQueueChannel} from '../cross-tab-channel';
import {createOfflineTestContext, testEnvelope} from './test-helpers';

describe('зашифрованная очередь команд', () => {
  it('подтверждает долговечную запись даже при сбое межвкладочного уведомления', async () => {
    const context = createOfflineTestContext();
    const queue = new OperatorCommandQueue(context.database, context.localCrypto, {
      publish() { throw new Error('Канал временно недоступен'); },
      subscribe() { return () => undefined; },
      close() {},
    });

    await expect(queue.enqueue(testEnvelope())).resolves.toMatchObject({status: 'pending'});
    await expect(queue.summary()).resolves.toMatchObject({pending: 1, total: 1});
  });

  it('переживает создание нового экземпляра и сохраняет тот же идентификатор команды', async () => {
    const context = createOfflineTestContext();
    const envelope = testEnvelope();
    await context.queue.enqueue(envelope);
    const restartedQueue = new OperatorCommandQueue(context.database, context.localCrypto, createMemoryCrossTabQueueChannel());

    const afterRestart = await restartedQueue.list();
    expect(afterRestart).toHaveLength(1);
    expect(afterRestart[0]?.envelope.commandId).toBe(envelope.commandId);
    await restartedQueue.enqueue(envelope);
    expect(await restartedQueue.list()).toHaveLength(1);
    const raw = await context.database.getCommand(envelope.commandId);
    expect(raw).not.toBeNull();
    if (!raw) throw new Error('Команда не сохранена');
    expect(new TextDecoder().decode(raw.encrypted.ciphertext)).not.toContain('секретная заметка');
  });

  it('не перезаписывает спорную команду и не принимает другое содержимое с тем же идентификатором', async () => {
    const context = createOfflineTestContext();
    const envelope = testEnvelope();
    await context.queue.enqueue(envelope, 100);
    await context.queue.claimNext('вкладка-1', 100);
    await context.queue.markConflict(envelope.commandId, 'вкладка-1', 'ВЕРСИЯ_ИЗМЕНЕНА', 'Нужно обновить данные');

    expect((await context.queue.list())[0]).toMatchObject({status: 'conflict', issue: {code: 'ВЕРСИЯ_ИЗМЕНЕНА'}});
    await expect(context.queue.enqueue({...envelope, payload: {comment: 'другое'}})).rejects.toThrow('уже связан');
    expect((await context.queue.list())[0]?.status).toBe('conflict');
  });
});
