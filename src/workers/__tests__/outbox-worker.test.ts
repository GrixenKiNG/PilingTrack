/**
 * Outbox Publisher — Unit Tests
 *
 * Tests the transactional outbox pattern:
 * - Publishing events from outbox
 * - Retry with exponential backoff
 * - Dead Letter Queue after max retries
 * - Idempotency (no double-processing)
 * - Batch processing
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock db BEFORE importing publisher
const mocks = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  mockFindUnique: vi.fn(),
  mockUpdate: vi.fn(),
  mockUpdateMany: vi.fn(),
  mockCount: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    outboxEvent: {
      findMany: mocks.mockFindMany,
      findUnique: mocks.mockFindUnique,
      update: mocks.mockUpdate,
      // The publisher uses updateMany for the atomic claim (compare-and-swap
      // on the consumer column). update is reserved for the retry path.
      updateMany: mocks.mockUpdateMany,
      count: mocks.mockCount,
    },
  },
}));

vi.mock('@/core/outbox/dead-letter-queue', () => ({
  moveToDlq: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import after mocks
import { publishOutboxEvents, startOutboxWorker, getOutboxStats } from '@/modules/reports/server';
import * as dlqModule from '@/core/outbox/dead-letter-queue';

// ============================================================
// Helpers
// ============================================================

function createOutboxEvent(overrides = {}) {
  return {
    id: 'event-1',
    type: 'report.created',
    aggregateId: 'report-1',
    aggregateType: 'Report',
    tenantId: 'tenant-1',
    payload: { type: 'report.created', aggregateId: 'report-1' },
    published: false,
    attempts: 0,
    lastError: null,
    occurredAt: new Date(),
    createdAt: new Date(),
    publishedAt: null,
    ...overrides,
  };
}

// ============================================================
// Tests
// ============================================================

describe('Outbox Publisher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('publishOutboxEvents', () => {
    it('publishes unpublished events to handler', async () => {
      const event = createOutboxEvent();
      mocks.mockFindMany.mockResolvedValue([event]);
      mocks.mockUpdateMany.mockResolvedValue({ count: 1 });

      const handler = vi.fn().mockResolvedValue(undefined);
      const count = await publishOutboxEvents(handler);

      expect(count).toBe(1);
      expect(handler).toHaveBeenCalledTimes(1);
      // The publisher reconstructs the event from outbox columns + payload,
      // overriding routing fields with canonical column values.
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          id: event.id,
          type: event.type,
          aggregateId: event.aggregateId,
          aggregateType: event.aggregateType,
        })
      );
    });

    it('returns 0 when no unpublished events', async () => {
      mocks.mockFindMany.mockResolvedValue([]);

      const handler = vi.fn();
      const count = await publishOutboxEvents(handler);

      expect(count).toBe(0);
      expect(handler).not.toHaveBeenCalled();
    });

    it('marks events as published after successful handling', async () => {
      const event = createOutboxEvent();
      mocks.mockFindMany.mockResolvedValue([event]);
      mocks.mockUpdateMany.mockResolvedValue({ count: 1 });

      const handler = vi.fn().mockResolvedValue(undefined);
      await publishOutboxEvents(handler);

      // Atomic compare-and-swap: claim the row only if still published=false.
      expect(mocks.mockUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: event.id, published: false },
          data: expect.objectContaining({ published: true }),
        })
      );
    });

    it('handles race when another worker claimed the row first', async () => {
      // Two replicas can both pass the findMany window. The atomic updateMany
      // returns {count: 0} for the loser, which must NOT count toward
      // processedCount. The handler still ran (idempotency is the handler's
      // responsibility — see consumeOutboxEvents comment).
      const event = createOutboxEvent();
      mocks.mockFindMany.mockResolvedValue([event]);
      mocks.mockUpdateMany.mockResolvedValue({ count: 0 });

      const handler = vi.fn().mockResolvedValue(undefined);
      const count = await publishOutboxEvents(handler);

      expect(count).toBe(0);
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('retries failed events (increments attempts)', async () => {
      const event = createOutboxEvent({ attempts: 2 });
      mocks.mockFindMany.mockResolvedValue([event]);
      mocks.mockUpdate.mockResolvedValue({});

      const handler = vi.fn().mockRejectedValue(new Error('Handler error'));
      const count = await publishOutboxEvents(handler);

      expect(count).toBe(0);
      // Should increment attempts
      expect(mocks.mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: event.id },
          data: expect.objectContaining({
            attempts: 3,
            lastError: 'Handler error',
          }),
        })
      );
    });

    it('moves to DLQ after max retries exceeded', async () => {
      const event = createOutboxEvent({ attempts: 4 }); // One more = MAX_RETRIES (5)
      mocks.mockFindMany.mockResolvedValue([event]);
      mocks.mockUpdate.mockResolvedValue({});

      const handler = vi.fn().mockRejectedValue(new Error('Persistent failure'));
      await publishOutboxEvents(handler);

      expect(dlqModule.moveToDlq).toHaveBeenCalledWith(
        event.id,
        event.type,
        event.aggregateId,
        event.payload,
        expect.any(Error),
        5,
        expect.objectContaining({ consumer: 'published' }),
      );
    });

    it('processes events in batch (up to BATCH_SIZE)', async () => {
      const events = Array.from({ length: 5 }, (_, i) =>
        createOutboxEvent({ id: `event-${i}` })
      );
      mocks.mockFindMany.mockResolvedValue(events);
      mocks.mockUpdateMany.mockResolvedValue({ count: 1 });

      const handler = vi.fn().mockResolvedValue(undefined);
      const count = await publishOutboxEvents(handler);

      expect(count).toBe(5);
      expect(handler).toHaveBeenCalledTimes(5);
    });

    it('continues processing after individual event failure', async () => {
      const events = [
        createOutboxEvent({ id: 'event-ok-1', aggregateId: 'r1' }),
        createOutboxEvent({ id: 'event-fail', aggregateId: 'r2', attempts: 2 }),
        createOutboxEvent({ id: 'event-ok-2', aggregateId: 'r3' }),
      ];
      mocks.mockFindMany.mockResolvedValue(events);
      mocks.mockUpdate.mockResolvedValue({});
      mocks.mockUpdateMany.mockResolvedValue({ count: 1 });

      let failCount = 0;
      const handler = vi.fn().mockImplementation(async () => {
        failCount++;
        if (failCount === 2) {
          throw new Error('Fail on second event');
        }
      });

      // All 3 events will be processed — handler called 3 times
      await publishOutboxEvents(handler);
      expect(handler).toHaveBeenCalledTimes(3);

      // 2 successful claims via updateMany, 1 retry via update.
      expect(mocks.mockUpdateMany).toHaveBeenCalledTimes(2);
      expect(mocks.mockUpdate).toHaveBeenCalledTimes(1);
    });
  });

  describe('startOutboxWorker', () => {
    it.each(['SIGTERM', 'SIGINT'] as const)('W121: %s and repeated stop release only this worker\'s listeners', async signal => {
      mocks.mockFindMany.mockResolvedValue([]);
      const before = { SIGTERM: process.listeners('SIGTERM'), SIGINT: process.listeners('SIGINT') };
      const worker = startOutboxWorker(vi.fn());
      const added = {
        SIGTERM: process.listeners('SIGTERM').filter(listener => !before.SIGTERM.includes(listener)),
        SIGINT: process.listeners('SIGINT').filter(listener => !before.SIGINT.includes(listener)),
      };
      try {
        expect(added[signal]).toHaveLength(1);
        added[signal][0]();
        worker.stop(); worker.stop();
        expect(process.listeners('SIGTERM')).toEqual(before.SIGTERM);
        expect(process.listeners('SIGINT')).toEqual(before.SIGINT);
      } finally {
        worker.stop();
        for (const name of ['SIGTERM', 'SIGINT'] as const) {
          for (const listener of added[name]) process.removeListener(name, listener);
        }
      }
    });

    it('creates a polling worker with default interval', () => {
      mocks.mockFindMany.mockResolvedValue([]);

      const handler = vi.fn();
      const worker = startOutboxWorker(handler);

      expect(worker).toHaveProperty('stop');
      expect(typeof worker.stop).toBe('function');

      worker.stop();
    });

    it('calls handler on each poll interval', async () => {
      const event = createOutboxEvent();
      mocks.mockFindMany
        .mockResolvedValueOnce([event])
        .mockResolvedValue([]);
      mocks.mockFindUnique.mockResolvedValue({ published: false });
      mocks.mockUpdate.mockResolvedValue({});

      const handler = vi.fn().mockResolvedValue(undefined);
      const worker = startOutboxWorker(handler, 1000); // 1s interval

      // Fast-forward time
      await vi.advanceTimersByTimeAsync(1000);

      expect(handler).toHaveBeenCalledTimes(1);

      worker.stop();
    });

    it('does not overlap passes: a tick during an in-flight pass is skipped (re-entrancy guard)', async () => {
      // Guards the duplicate-Telegram-report bug: consumeOutboxEvents dispatches
      // the (non-idempotent) handler before claiming the row, so an overlapping
      // pass would re-send the same not-yet-published report PDF. Simulate a slow
      // pass by hanging the first findMany, then fire the interval again.
      let releaseFirstPass!: () => void;
      mocks.mockFindMany.mockImplementationOnce(
        () => new Promise((resolve) => { releaseFirstPass = () => resolve([]); })
      );
      mocks.mockFindMany.mockResolvedValue([]);

      const handler = vi.fn().mockResolvedValue(undefined);
      const worker = startOutboxWorker(handler, 1000);

      // Immediate processOnce() has entered: по одному проходу на полосу
      // (общая и Telegram); первый findMany общей полосы висит.
      await Promise.resolve();
      expect(mocks.mockFindMany).toHaveBeenCalledTimes(2);

      // A tick fires while the first pass is still in flight — общая полоса
      // пропускает его, Telegram-полоса (проход уже завершён) идёт дальше.
      await vi.advanceTimersByTimeAsync(1000);
      const generalCalls = () => mocks.mockFindMany.mock.calls.filter(([args]) => args.where.type?.notIn);
      expect(generalCalls()).toHaveLength(1);

      // Once the first pass finishes, later ticks run normally again.
      releaseFirstPass();
      await vi.advanceTimersByTimeAsync(1000);
      expect(generalCalls().length).toBeGreaterThan(1);

      worker.stop();
    });

    describe('полосы публикации: зависший Telegram не держит остальные события (F7)', () => {
      const PDF = 'ReportPdfDeliveryRequested';
      const ALERT = 'NotificationDeliveryRequested';

      /** Мини-outbox в памяти: findMany понимает фильтр type {in|notIn}, updateMany — claim. */
      function fakeOutbox(events: Array<ReturnType<typeof createOutboxEvent>>) {
        const rows = new Map(events.map((e) => [e.id, { ...e }]));
        mocks.mockFindMany.mockImplementation(async (args: { where: { type?: { in?: string[]; notIn?: string[] } } }) => {
          const t = args.where.type;
          return [...rows.values()].filter((r) => {
            if (r.published) return false;
            if (t?.in) return t.in.includes(r.type);
            if (t?.notIn) return !t.notIn.includes(r.type);
            return true;
          });
        });
        mocks.mockUpdateMany.mockImplementation(async (args: { where: { id: string } }) => {
          const row = rows.get(args.where.id);
          if (!row || row.published) return { count: 0 };
          row.published = true;
          return { count: 1 };
        });
        return rows;
      }

      it('событие, не связанное с Telegram, публикуется, пока доставка PDF висит', async () => {
        const rows = fakeOutbox([
          createOutboxEvent({ id: 'pdf-A', type: PDF, aggregateId: 'rep-A', createdAt: new Date(1) }),
          createOutboxEvent({ id: 'sub-B', type: 'ReportSubmitted', aggregateId: 'rep-B', createdAt: new Date(2) }),
        ]);
        let releasePdf!: () => void;
        const handler = vi.fn((event: { type: string }) =>
          event.type === PDF ? new Promise<void>((resolve) => { releasePdf = resolve; }) : Promise.resolve(),
        );

        const worker = startOutboxWorker(handler as never, 1000);
        await vi.advanceTimersByTimeAsync(1);

        // PDF «зависло» в Telegram, а ReportSubmitted чужого отчёта уже опубликован.
        expect(rows.get('sub-B')?.published).toBe(true);
        expect(rows.get('pdf-A')?.published).toBe(false);

        // Повторные тики не запускают зависшую доставку второй раз (ровно один раз).
        await vi.advanceTimersByTimeAsync(5000);
        expect(handler.mock.calls.filter(([e]) => e.type === PDF)).toHaveLength(1);

        releasePdf();
        await vi.advanceTimersByTimeAsync(1);
        expect(rows.get('pdf-A')?.published).toBe(true);
        worker.stop();
      });

      it('доставка уведомлений тоже идёт в своей полосе, общая полоса не ждёт её', async () => {
        const rows = fakeOutbox([
          createOutboxEvent({ id: 'alert-1', type: ALERT, aggregateId: 'x', createdAt: new Date(1) }),
          createOutboxEvent({ id: 'upd-1', type: 'ReportUpdated', aggregateId: 'rep-C', createdAt: new Date(2) }),
        ]);
        const handler = vi.fn((event: { type: string }) =>
          event.type === ALERT ? new Promise<void>(() => {}) : Promise.resolve(),
        );

        const worker = startOutboxWorker(handler as never, 1000);
        await vi.advanceTimersByTimeAsync(1);

        expect(rows.get('upd-1')?.published).toBe(true);
        worker.stop();
      });

      it('тип PDF-доставки в полосе совпадает с типом, который ставит обработчик отчёта', async () => {
        const { REPORT_PDF_DELIVERY_EVENT } = await import('@/modules/reports/server');
        const { TELEGRAM_LANE_EVENT_TYPES } = await import('@/modules/reports/server');
        expect(TELEGRAM_LANE_EVENT_TYPES).toContain(REPORT_PDF_DELIVERY_EVENT);
        expect(TELEGRAM_LANE_EVENT_TYPES).toContain(ALERT);
      });

      it('события одной полосы по-прежнему идут по одному и по порядку', async () => {
        const order: string[] = [];
        fakeOutbox([
          createOutboxEvent({ id: 'a', type: 'ReportCreated', aggregateId: 'r', createdAt: new Date(1) }),
          createOutboxEvent({ id: 'b', type: 'ReportSubmitted', aggregateId: 'r', createdAt: new Date(2) }),
        ]);
        const handler = vi.fn(async (event: { id: string }) => {
          order.push(`start:${event.id}`);
          await Promise.resolve();
          order.push(`end:${event.id}`);
        });

        const worker = startOutboxWorker(handler as never, 1000);
        await vi.advanceTimersByTimeAsync(1);

        expect(order).toEqual(['start:a', 'end:a', 'start:b', 'end:b']);
        worker.stop();
      });
    });

    it('stops polling after worker.stop()', async () => {
      mocks.mockFindMany.mockResolvedValue([]);

      const handler = vi.fn();
      const worker = startOutboxWorker(handler, 1000);

      worker.stop();

      // Fast-forward time
      await vi.advanceTimersByTimeAsync(3000);

      // Handler should NOT be called
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('getOutboxStats', () => {
    it('returns counts of unpublished, failed, and total events', async () => {
      mocks.mockCount
        .mockResolvedValueOnce(50)  // unpublished
        .mockResolvedValueOnce(5)   // failed
        .mockResolvedValueOnce(200); // total

      const stats = await getOutboxStats();

      expect(stats).toEqual({
        unpublished: 50,
        failed: 5,
        total: 200,
      });
    });
  });

  describe('saveToOutbox', () => {
    it('saves events to outbox within transaction', async () => {
      // Dynamic import to avoid early mock issues
      const { saveToOutbox } = await import('@/modules/reports/server');

      const mockTx = {
        outboxEvent: { create: vi.fn().mockResolvedValue({ id: 'outbox-1' }) },
      };

      const events = [
        { type: 'report.created', aggregateId: 'r1', aggregateType: 'Report' },
        { type: 'report.updated', aggregateId: 'r1', aggregateType: 'Report' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test: cast to a mock shape or to reach internals not in the public type
      ] as any[];

      await saveToOutbox(mockTx, events);

      expect(mockTx.outboxEvent.create).toHaveBeenCalledTimes(2);
    });

    it('does nothing for empty event array', async () => {
      const { saveToOutbox } = await import('@/modules/reports/server');

      const mockTx = {
        outboxEvent: { create: vi.fn() },
      };

      await saveToOutbox(mockTx, []);

      expect(mockTx.outboxEvent.create).not.toHaveBeenCalled();
    });
  });
});

it('I08: DLQ carries latest committed delivery receipts rather than the batch snapshot', async () => {
  const original = createOutboxEvent({ attempts: 4, type: 'NotificationDeliveryRequested', payload: { message: 'batch' } });
  const currentPayload = { message: 'batch', telegramDeliveredChatIds: ['A'] };
  mocks.mockFindMany.mockReset().mockResolvedValue([original]);
  mocks.mockFindUnique.mockReset().mockResolvedValue({ payload: currentPayload });
  mocks.mockUpdate.mockReset().mockResolvedValue({});
  vi.mocked(dlqModule.moveToDlq).mockClear();
  await publishOutboxEvents(async () => { throw new Error('B unavailable'); });
  expect(dlqModule.moveToDlq).toHaveBeenCalledWith(original.id, original.type, original.aggregateId,
    currentPayload, expect.any(Error), 5, expect.any(Object));
});
