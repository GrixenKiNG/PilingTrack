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
  mockCount: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    outboxEvent: {
      findMany: mocks.mockFindMany,
      findUnique: mocks.mockFindUnique,
      update: mocks.mockUpdate,
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
import { publishOutboxEvents, startOutboxWorker, getOutboxStats } from '@/services/reports/outbox-publisher';
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
      mocks.mockFindUnique.mockResolvedValue({ published: false });
      mocks.mockUpdate.mockResolvedValue({});

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
      mocks.mockFindUnique.mockResolvedValue({ published: false });
      mocks.mockUpdate.mockResolvedValue({});

      const handler = vi.fn().mockResolvedValue(undefined);
      await publishOutboxEvents(handler);

      // Should update with published: true and where published: false (atomic)
      expect(mocks.mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: event.id, published: false },
          data: expect.objectContaining({ published: true }),
        })
      );
    });

    it('skips already-published events (idempotency)', async () => {
      const event = createOutboxEvent();
      mocks.mockFindMany.mockResolvedValue([event]);
      // Race condition: another worker already published it
      mocks.mockFindUnique.mockResolvedValue({ published: true });

      const handler = vi.fn();
      const count = await publishOutboxEvents(handler);

      expect(count).toBe(0);
      expect(handler).not.toHaveBeenCalled();
    });

    it('retries failed events (increments attempts)', async () => {
      const event = createOutboxEvent({ attempts: 2 });
      mocks.mockFindMany.mockResolvedValue([event]);
      mocks.mockFindUnique.mockResolvedValue({ published: false });
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
      mocks.mockFindUnique.mockResolvedValue({ published: false });

      const handler = vi.fn().mockRejectedValue(new Error('Persistent failure'));
      await publishOutboxEvents(handler);

      expect(dlqModule.moveToDlq).toHaveBeenCalledWith(
        event.id,
        event.type,
        event.aggregateId,
        event.payload,
        expect.any(Error),
        5
      );
    });

    it('processes events in batch (up to BATCH_SIZE)', async () => {
      const events = Array.from({ length: 5 }, (_, i) =>
        createOutboxEvent({ id: `event-${i}` })
      );
      mocks.mockFindMany.mockResolvedValue(events);
      mocks.mockFindUnique.mockResolvedValue({ published: false });
      mocks.mockUpdate.mockResolvedValue({});

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
      mocks.mockFindUnique.mockResolvedValue({ published: false });
      mocks.mockUpdate.mockResolvedValue({});

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

      // All 3 events should have update called (2 published, 1 retry)
      expect(mocks.mockUpdate).toHaveBeenCalledTimes(3);
    });
  });

  describe('startOutboxWorker', () => {
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
      const { saveToOutbox } = await import('@/services/reports/outbox-publisher');

      const mockTx = {
        outboxEvent: { create: vi.fn().mockResolvedValue({ id: 'outbox-1' }) },
      };

      const events = [
        { type: 'report.created', aggregateId: 'r1', aggregateType: 'Report' },
        { type: 'report.updated', aggregateId: 'r1', aggregateType: 'Report' },
      ] as any[];

      await saveToOutbox(mockTx, events);

      expect(mockTx.outboxEvent.create).toHaveBeenCalledTimes(2);
    });

    it('does nothing for empty event array', async () => {
      const { saveToOutbox } = await import('@/services/reports/outbox-publisher');

      const mockTx = {
        outboxEvent: { create: vi.fn() },
      };

      await saveToOutbox(mockTx, []);

      expect(mockTx.outboxEvent.create).not.toHaveBeenCalled();
    });
  });
});
