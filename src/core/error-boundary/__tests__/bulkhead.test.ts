/**
 * Bulkhead — поведенческие тесты (N1021-H1).
 * Продуктовый код не менялся: тесты фиксируют наблюдаемое поведение
 * семафора, очереди ожидания и таймаутов.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Bulkhead, BulkheadRejectError } from '../bulkhead';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

function deferred<T>(): Deferred<T> {
  let resolveFn: (value: T) => void = () => {};
  let rejectFn: (error: Error) => void = () => {};

  const promise = new Promise<T>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });

  return { promise, resolve: resolveFn, reject: rejectFn };
}

/** Дать отработать микрозадачам, не сдвигая фейковые часы. */
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Bulkhead', () => {
  it('держит не больше maxConcurrency задач одновременно, остальные ждут в очереди', async () => {
    const bulkhead = new Bulkhead({
      maxConcurrency: 2,
      maxQueueSize: 5,
      timeoutMs: 1000,
      domain: 'test',
    });

    const gates = [deferred<string>(), deferred<string>(), deferred<string>()];
    const started: number[] = [];

    const first = bulkhead.execute(async () => {
      started.push(1);
      return gates[0].promise;
    });
    const second = bulkhead.execute(async () => {
      started.push(2);
      return gates[1].promise;
    });
    await flush();

    expect(started).toEqual([1, 2]);
    expect(bulkhead.getStats().activeRequests).toBe(2);

    const third = bulkhead.execute(async () => {
      started.push(3);
      return gates[2].promise;
    });
    await flush();

    // Третья задача не стартовала: оба слота заняты, она в очереди.
    expect(started).toEqual([1, 2]);
    expect(bulkhead.getStats().queuedRequests).toBe(1);

    gates[0].resolve('первый');
    await first;
    await flush();

    expect(started).toEqual([1, 2, 3]);
    expect(bulkhead.getStats().activeRequests).toBe(2);
    expect(bulkhead.getStats().queuedRequests).toBe(0);

    gates[1].resolve('второй');
    gates[2].resolve('третий');
    await Promise.all([second, third]);
    expect(bulkhead.getStats().activeRequests).toBe(0);
  });

  it('выпускает ожидающие задачи в порядке постановки (FIFO)', async () => {
    const bulkhead = new Bulkhead({
      maxConcurrency: 1,
      maxQueueSize: 5,
      timeoutMs: 1000,
      domain: 'test',
    });

    const gate = deferred<string>();
    const order: string[] = [];

    const first = bulkhead.execute(async () => {
      order.push('первая');
      return gate.promise;
    });

    const queued = ['вторая', 'третья', 'четвёртая'].map((name) =>
      bulkhead.execute(async () => {
        order.push(name);
        return name;
      })
    );

    await flush();
    expect(bulkhead.getStats().queuedRequests).toBe(3);

    gate.resolve('готово');
    await first;
    await Promise.all(queued);

    expect(order).toEqual(['первая', 'вторая', 'третья', 'четвёртая']);
  });

  it('отклоняет запрос с BulkheadRejectError, когда очередь переполнена', async () => {
    const bulkhead = new Bulkhead({
      maxConcurrency: 1,
      maxQueueSize: 1,
      timeoutMs: 5000,
      domain: 'test',
    });

    const gate = deferred<string>();
    const first = bulkhead.execute(() => gate.promise);
    const queued = bulkhead.execute(async () => 'в очереди');
    await flush();

    expect(bulkhead.getStats().queuedRequests).toBe(1);

    await expect(bulkhead.execute(async () => 'лишний')).rejects.toBeInstanceOf(
      BulkheadRejectError
    );
    expect(bulkhead.getStats().rejectedRequests).toBe(1);

    gate.resolve('готово');
    await first;
    await expect(queued).resolves.toBe('в очереди');
    expect(bulkhead.getStats().activeRequests).toBe(0);
  });

  it('освобождает слот после ошибки задачи и запускает следующую из очереди', async () => {
    const bulkhead = new Bulkhead({
      maxConcurrency: 1,
      maxQueueSize: 2,
      timeoutMs: 5000,
      domain: 'test',
    });

    const gate = deferred<string>();
    const failing = bulkhead.execute(async () => {
      await gate.promise;
      throw new Error('сломалось');
    });
    const next = bulkhead.execute(async () => 'следующая');

    await flush();
    expect(bulkhead.getStats().queuedRequests).toBe(1);

    gate.resolve('готово');
    await expect(failing).rejects.toThrow('сломалось');
    await expect(next).resolves.toBe('следующая');

    expect(bulkhead.getStats().activeRequests).toBe(0);
    expect(bulkhead.getStats().queuedRequests).toBe(0);
  });

  it('отклоняет задачу, провисевшую в очереди дольше timeoutMs', async () => {
    const bulkhead = new Bulkhead({
      maxConcurrency: 1,
      maxQueueSize: 2,
      timeoutMs: 1000,
      domain: 'test',
    });

    // Первая задача занята надолго — её собственный таймаут заведомо больше времени ожидания.
    void bulkhead.execute(() => new Promise<string>(() => {}), { timeoutMs: 60_000 });
    const waiting = bulkhead.execute(async () => 'не дождалась');

    const waitingRejected = expect(waiting).rejects.toBeInstanceOf(BulkheadRejectError);
    expect(bulkhead.getStats().queuedRequests).toBe(1);

    await vi.advanceTimersByTimeAsync(1000);
    await waitingRejected;

    expect(bulkhead.getStats().timedOutRequests).toBe(1);
    expect(bulkhead.getStats().rejectedRequests).toBe(1);
  });

  it('прерывает зависшую задачу по таймауту выполнения и освобождает слот', async () => {
    const bulkhead = new Bulkhead({
      maxConcurrency: 1,
      maxQueueSize: 2,
      timeoutMs: 1000,
      domain: 'test',
    });

    const hung = bulkhead.execute(() => new Promise<string>(() => {}));
    const hungRejected = expect(hung).rejects.toThrow(
      'Bulkhead timeout after 1000ms (domain: test)'
    );

    await vi.advanceTimersByTimeAsync(1000);
    await hungRejected;

    expect(bulkhead.getStats().activeRequests).toBe(0);
    await expect(bulkhead.execute(async () => 'после таймаута')).resolves.toBe('после таймаута');
  });

  it.fails(
    'снимает истёкшую по таймауту задачу с очереди (дефект: запись остаётся и занимает maxQueueSize)',
    async () => {
      const bulkhead = new Bulkhead({
        maxConcurrency: 1,
        maxQueueSize: 1,
        timeoutMs: 1000,
        domain: 'test',
      });

      void bulkhead.execute(() => new Promise<string>(() => {}), { timeoutMs: 60_000 });
      const waiting = bulkhead.execute(async () => 'не дождалась');
      const waitingRejected = expect(waiting).rejects.toBeInstanceOf(BulkheadRejectError);

      await vi.advanceTimersByTimeAsync(1000);
      await waitingRejected;

      // дефект: таймаут ожидания отклоняет промис, но запись не удаляется из this.queue,
      // поэтому мёртвая запись считается в queuedRequests и продолжает занимать maxQueueSize —
      // следующий запрос получает 503, хотя очередь фактически пуста.
      expect(bulkhead.getStats().queuedRequests, 'истёкшая запись должна покинуть очередь').toBe(0);
      await expect(bulkhead.execute(async () => 'новая')).resolves.toBe('новая');
    }
  );
});
