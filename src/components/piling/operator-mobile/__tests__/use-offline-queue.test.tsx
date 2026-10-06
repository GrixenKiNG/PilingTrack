import {act, renderHook} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {QueuedCommand} from '../offline-queue';

const queue = vi.hoisted(() => ({
  flushQueue: vi.fn(),
  readQueue: vi.fn(),
}));

vi.mock('../offline-queue', () => ({
  discard: vi.fn(),
  flushQueue: queue.flushQueue,
  readQueue: queue.readQueue,
  retry: vi.fn(),
  subscribeQueue: vi.fn(() => () => {}),
}));
vi.mock('../api', () => ({sendQueuedCommand: vi.fn()}));

import {useOfflineQueue} from '../use-offline-queue';

const pendingCommand = {state: 'PENDING'} as QueuedCommand;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-01T00:00:00.000Z'));
  vi.stubGlobal('navigator', {onLine: false});
  queue.flushQueue.mockResolvedValue({sent: 0});
  queue.readQueue.mockReturnValue([pendingCommand]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('useOfflineQueue — повторная отправка при ложном navigator.onLine (F-V1-ONLINE-FLAG)', () => {
  it('пробует очередь через 60 секунд офлайн, но не на обычном 30-секундном тике', async () => {
    renderHook(() => useOfflineQueue());
    expect(queue.flushQueue).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(queue.flushQueue).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(queue.flushQueue).toHaveBeenCalledTimes(2);
  });

  it('при navigator.onLine=true сохраняет прежний интервал 30 секунд', async () => {
    vi.stubGlobal('navigator', {onLine: true});
    renderHook(() => useOfflineQueue());
    expect(queue.flushQueue).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(queue.flushQueue).toHaveBeenCalledTimes(2);

    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(queue.flushQueue).toHaveBeenCalledTimes(3);
  });
});
