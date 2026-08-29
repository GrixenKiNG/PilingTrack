import {describe, expect, it, vi} from 'vitest';
import {OperatorQueueSynchronizer, type QueueTransport} from '../queue-synchronizer';
import {createOfflineTestContext, testEnvelope} from './test-helpers';

describe('синхронизация очереди', () => {
  it('отправляет сохранённую команду один раз и удаляет только после подтверждения', async () => {
    const context = createOfflineTestContext();
    const envelope = testEnvelope();
    await context.queue.enqueue(envelope);
    const send = vi.fn<QueueTransport['send']>().mockResolvedValue({kind: 'confirmed', confirmedAttachmentIds: []});
    const synchronizer = new OperatorQueueSynchronizer(context.queue, context.attachments, {send});

    const [first, second] = await Promise.all([synchronizer.synchronize(), synchronizer.synchronize()]);
    expect(first.confirmed).toBe(1);
    expect(second).toEqual(first);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0].commandId).toBe(envelope.commandId);
    expect((await context.queue.summary()).total).toBe(0);
  });

  it('сохраняет команду и вложение, если сервер не подтвердил вложение', async () => {
    const context = createOfflineTestContext();
    const attachment = await context.attachments.save('11111111-1111-4111-8111-111111111111', new Blob([new Uint8Array([1])], {type: 'image/jpeg'}), 'доказательство.jpg', 'вложение-1');
    await context.queue.enqueue(testEnvelope({attachmentIds: [attachment.attachmentId]}));
    const synchronizer = new OperatorQueueSynchronizer(context.queue, context.attachments, {send: async () => ({kind: 'confirmed', confirmedAttachmentIds: []})});

    const report = await synchronizer.synchronize();
    expect(report).toMatchObject({confirmed: 0, deferred: 1, remaining: 1});
    expect((await context.queue.list())[0]).toMatchObject({status: 'failed', issue: {code: 'ВЛОЖЕНИЕ_НЕ_ПОДТВЕРЖДЕНО'}});
    expect((await context.attachments.get('вложение-1'))?.serverConfirmed).toBe(false);
  });

  it('сохраняет конфликт для ручного разбора', async () => {
    const context = createOfflineTestContext();
    await context.queue.enqueue(testEnvelope());
    const synchronizer = new OperatorQueueSynchronizer(context.queue, context.attachments, {send: async () => ({kind: 'conflict', code: 'ВЕРСИЯ_ИЗМЕНЕНА', message: 'Рабочее место обновилось'})});

    expect(await synchronizer.synchronize()).toMatchObject({conflicts: 1, remaining: 1});
    expect((await context.queue.list())[0]).toMatchObject({status: 'conflict', issue: {code: 'ВЕРСИЯ_ИЗМЕНЕНА'}});
  });
});
