import {act, renderHook} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import type {OperatorAction} from '../../api/contracts';
import {createMemoryCrossTabQueueChannel} from '../cross-tab-channel';
import type {OperatorOfflineServices} from '../operator-offline-services';
import {OperatorQueueSynchronizer, type QueueTransport} from '../queue-synchronizer';
import {useQueuedOperatorCommand} from '../use-queued-operator-command';
import {createOfflineTestContext} from './test-helpers';

const action: OperatorAction = {
  id: 'record-production', label: 'Записать выработку', kind: 'COMMAND', method: 'POST',
  route: '/api/operator/v3/commands/record-production', expectedVersion: 4,
  offlinePolicy: 'CAPTURE_ONLY', requiresEvidence: [], confirmation: null,
};

function services(send: QueueTransport['send']) {
  const context = createOfflineTestContext();
  const channel = createMemoryCrossTabQueueChannel();
  const value: OperatorOfflineServices = {
    queue: context.queue,
    synchronizer: new OperatorQueueSynchronizer(context.queue, context.attachments, {send}),
    channel,
    close: () => channel.close(),
  };
  return {context, value};
}

afterEach(() => { vi.restoreAllMocks(); });

describe('команда с защищённой локальной очередью', () => {
  it('сохраняет команду до транспорта и повторно использует тот же commandId', async () => {
    const observed: string[] = [];
    let queue = services(async () => ({kind: 'retry', code: 'НЕ_ИСПОЛЬЗУЕТСЯ', message: 'Не используется'}));
    const send = vi.fn<QueueTransport['send']>(async (_envelope) => {
      observed.push(...(await queue.context.queue.list()).map((item) => item.envelope.commandId));
      return {kind: 'confirmed', confirmedAttachmentIds: []};
    });
    queue = services(send);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    const {result} = renderHook(() => useQueuedOperatorCommand(vi.fn(), queue.value, 'устройство-1'));

    let completed = false;
    await act(async () => { completed = await result.current.execute(action, {depth: 3}, 'команда-один'); });

    expect(completed).toBe(true);
    expect(observed).toContain('команда-один');
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0].commandId).toBe('команда-один');
    expect((await queue.context.queue.summary()).total).toBe(0);
  });

  it('без связи оставляет команду в очереди и не вызывает транспорт', async () => {
    const send = vi.fn<QueueTransport['send']>();
    const queue = services(send);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const {result} = renderHook(() => useQueuedOperatorCommand(vi.fn(), queue.value, 'устройство-1'));

    let completed = false;
    await act(async () => { completed = await result.current.execute(action, {}, 'команда-офлайн'); });

    expect(completed).toBe(true);
    expect(send).not.toHaveBeenCalled();
    expect(await queue.context.queue.summary()).toMatchObject({pending: 1, total: 1});
    expect(result.current.message).toContain('сохранено на устройстве');
  });

  it('не превращает наличие сети в полномочие на запрещённое офлайн-действие', async () => {
    const send = vi.fn<QueueTransport['send']>();
    const queue = services(send);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const {result} = renderHook(() => useQueuedOperatorCommand(vi.fn(), queue.value, 'устройство-1'));

    await act(async () => { await result.current.execute({...action, offlinePolicy: 'AUTHORIZED'}); });

    expect(await queue.context.queue.summary()).toMatchObject({total: 0});
    expect(result.current.message).toContain('подписанное разрешение');
  });
});
