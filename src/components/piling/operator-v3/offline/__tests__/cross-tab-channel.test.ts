import {describe, expect, it, vi} from 'vitest';
import {createMemoryCrossTabQueueChannel} from '../cross-tab-channel';

describe('межвкладочный сигнал очереди', () => {
  it('сообщает только о факте изменения без передачи содержимого команды', () => {
    const channel = createMemoryCrossTabQueueChannel();
    const listener = vi.fn();
    const unsubscribe = channel.subscribe(listener);
    channel.publish();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]).toEqual([]);
    unsubscribe();
    channel.publish();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
