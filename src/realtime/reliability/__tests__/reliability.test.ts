/**
 * Realtime Reliability Layer — Unit Tests
 *
 * Tests:
 * - Message ack/nack
 * - Replay buffer
 * - Backpressure control
 * - Sequence ordering
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  MessageTracker,
  ReplayBufferManager,
  BackpressureController,
  DEFAULT_RELIABILITY_CONFIG,
} from '@/realtime/reliability';
import type { ReportUpdatedEvent } from '@/realtime/types/events';

// ============================================================
// Helpers
// ============================================================

function createEvent(overrides: Partial<ReportUpdatedEvent> = {}): ReportUpdatedEvent {
  return {
    id: crypto.randomUUID(),
    type: 'report.updated',
    entity: 'report',
    entityId: 'report-1',
    payload: {
      reportId: 'report-1',
      totalPiles: 0,
      totalDrilling: 0,
      totalDowntime: 0,
      status: 'draft',
      updatedAt: new Date().toISOString(),
    },
    tenantId: 'tenant-1',
    siteId: 'site-1',
    userId: 'user-1',
    ts: Date.now(),
    ...overrides,
  };
}

// ============================================================
// Tests
// ============================================================

describe('MessageTracker', () => {
  let tracker: MessageTracker;

  beforeEach(() => {
    vi.useFakeTimers();
    tracker = new MessageTracker(DEFAULT_RELIABILITY_CONFIG);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates messages with incrementing sequence numbers', () => {
    const msg1 = tracker.createMessage(createEvent());
    const msg2 = tracker.createMessage(createEvent());

    expect(msg1.seq).toBe(1);
    expect(msg2.seq).toBe(2);
    expect(msg1.id).not.toBe(msg2.id);
  });

  it('tracks acked vs unacked messages', () => {
    const msg1 = tracker.createMessage(createEvent());
    const msg2 = tracker.createMessage(createEvent());

    tracker.ack(msg1.id);

    const stats = tracker.getStats();
    expect(stats.total).toBe(2);
    expect(stats.acked).toBe(1);
    expect(stats.unacked).toBe(1);
  });

  it('returns false for unknown message ack', () => {
    expect(tracker.ack('unknown-id')).toBe(false);
  });

  it('handles nack and increments retries', () => {
    const msg = tracker.createMessage(createEvent());

    const result = tracker.nack(msg.id, 'parse_error');

    expect(result).not.toBeNull();
    expect(result!.retries).toBe(1);
  });

  it('returns unacked messages from sequence', () => {
    const msg1 = tracker.createMessage(createEvent());
    tracker.ack(msg1.id);

    const msg2 = tracker.createMessage(createEvent());
    const msg3 = tracker.createMessage(createEvent());

    const unacked = tracker.getUnackedMessages(msg1.seq);

    expect(unacked).toHaveLength(2);
    expect(unacked[0].seq).toBe(2);
    expect(unacked[1].seq).toBe(3);
  });

  it('returns messages in sequence range', () => {
    tracker.createMessage(createEvent()); // seq 1
    tracker.createMessage(createEvent()); // seq 2
    tracker.createMessage(createEvent()); // seq 3

    const range = tracker.getMessagesInRange(2, 3);

    expect(range).toHaveLength(2);
    expect(range[0].seq).toBe(2);
    expect(range[1].seq).toBe(3);
  });

  it('prunes old acked messages', () => {
    const msg1 = tracker.createMessage(createEvent());
    tracker.ack(msg1.id);

    // Fast-forward time past maxAge
    vi.advanceTimersByTime(61000);

    tracker.pruneAckedMessages(60000);

    const stats = tracker.getStats();
    expect(stats.total).toBe(0);
  });

  it('evicts messages that time out without an ack', () => {
    // Previously the timeout handler only removed the timer entry and left
    // the tracked message behind, which caused unacked messages from
    // disconnected clients to leak forever (pruneAckedMessages only touches
    // already-acked rows). The handler now evicts the timed-out message so
    // the tracker is bounded under misbehaving / disconnected clients.
    const msg = tracker.createMessage(createEvent());
    expect(tracker.getStats().unacked).toBe(1);

    // Fast-forward past ackTimeoutMs
    vi.advanceTimersByTime(31000);

    const stats = tracker.getStats();
    expect(stats.unacked).toBe(0);
    expect(stats.total).toBe(0);
    // Subsequent ack attempts for the evicted id should be a no-op
    expect(tracker.ack(msg.id)).toBe(false);
  });
});

describe('ReplayBufferManager', () => {
  let buffer: ReplayBufferManager;

  beforeEach(() => {
    buffer = new ReplayBufferManager(DEFAULT_RELIABILITY_CONFIG);
  });

  it('creates a buffer for a client', () => {
    const buf = buffer.createBuffer('client-1');

    expect(buf.clientId).toBe('client-1');
    expect(buf.messages).toEqual([]);
    expect(buf.lastAckedSeq).toBe(0);
  });

  it('adds messages to client buffer', () => {
    buffer.createBuffer('client-1');
    const msg = {
      id: 'msg-1',
      seq: 1,
      event: createEvent(),
      sentAt: Date.now(),
      acked: false,
      retries: 0,
    };

    buffer.addMessage('client-1', msg);

    const clientBuffer = (buffer as any).buffers.get('client-1');
    expect(clientBuffer.messages).toHaveLength(1);
  });

  it('enforces buffer size limit', () => {
    buffer.createBuffer('client-1');

    // Add more messages than replayBufferSize
    for (let i = 0; i < 510; i++) {
      buffer.addMessage('client-1', {
        id: `msg-${i}`,
        seq: i,
        event: createEvent(),
        sentAt: Date.now(),
        acked: false,
        retries: 0,
      });
    }

    const stats = buffer.getStats();
    expect(stats.totalBufferedMessages).toBe(500); // replayBufferSize
  });

  it('acks messages and updates lastAckedSeq', () => {
    buffer.createBuffer('client-1');
    const msg = {
      id: 'msg-1',
      seq: 5,
      event: createEvent(),
      sentAt: Date.now(),
      acked: false,
      retries: 0,
    };
    buffer.addMessage('client-1', msg);

    buffer.ackMessage('client-1', 'msg-1');

    const clientBuffer = (buffer as any).buffers.get('client-1');
    expect(clientBuffer.lastAckedSeq).toBe(5);
    expect(clientBuffer.messages[0].acked).toBe(true);
  });

  it('returns replay messages from sequence', () => {
    buffer.createBuffer('client-1');

    for (let i = 1; i <= 5; i++) {
      buffer.addMessage('client-1', {
        id: `msg-${i}`,
        seq: i,
        event: createEvent(),
        sentAt: Date.now(),
        acked: false,
        retries: 0,
      });
    }

    const replay = buffer.getReplayMessages('client-1', 3);

    expect(replay).toHaveLength(2);
    expect(replay[0].seq).toBe(4);
    expect(replay[1].seq).toBe(5);
  });

  it('limits replay count', () => {
    buffer.createBuffer('client-1');

    for (let i = 0; i < 300; i++) {
      buffer.addMessage('client-1', {
        id: `msg-${i}`,
        seq: i,
        event: createEvent(),
        sentAt: Date.now(),
        acked: false,
        retries: 0,
      });
    }

    const replay = buffer.getReplayMessages('client-1', 0);

    expect(replay.length).toBeLessThanOrEqual(200); // maxReplayCount
  });

  it('detects backpressure when unacked messages exceed limit', () => {
    buffer.createBuffer('client-1');

    // Add more than maxUnacked (50) messages
    for (let i = 0; i < 60; i++) {
      buffer.addMessage('client-1', {
        id: `msg-${i}`,
        seq: i,
        event: createEvent(),
        sentAt: Date.now(),
        acked: false,
        retries: 0,
      });
    }

    expect(buffer.isClientUnderBackpressure('client-1')).toBe(true);
  });

  it('relieves backpressure when messages are acked', () => {
    buffer.createBuffer('client-1');

    // Add 60 unacked messages
    for (let i = 0; i < 60; i++) {
      buffer.addMessage('client-1', {
        id: `msg-${i}`,
        seq: i,
        event: createEvent(),
        sentAt: Date.now(),
        acked: false,
        retries: 0,
      });
    }

    expect(buffer.isClientUnderBackpressure('client-1')).toBe(true);

    // Ack enough to relieve backpressure
    for (let i = 0; i < 30; i++) {
      buffer.ackMessage('client-1', `msg-${i}`);
    }

    expect(buffer.isClientUnderBackpressure('client-1')).toBe(false);
  });

  it('removes client buffer', () => {
    buffer.createBuffer('client-1');
    buffer.removeBuffer('client-1');

    expect(buffer.getStats().clientCount).toBe(0);
  });
});

describe('BackpressureController', () => {
  let controller: BackpressureController;

  beforeEach(() => {
    controller = new BackpressureController(DEFAULT_RELIABILITY_CONFIG);
  });

  it('initializes client state', () => {
    controller.initClient('client-1');

    const state = controller.getState('client-1');
    expect(state.isThrottled).toBe(false);
    expect(state.queuedMessages).toBe(0);
  });

  it('allows sends by default', () => {
    controller.initClient('client-1');

    expect(controller.canSendMessage('client-1')).toBe(true);
  });

  it('throttles client on repeated failures', () => {
    controller.initClient('client-1');

    // Simulate many failed sends
    for (let i = 0; i < 60; i++) {
      controller.canSendMessage('client-1'); // returns false when throttled
      controller.recordSend('client-1', false);
    }

    const state = controller.getState('client-1');
    expect(state.isThrottled).toBe(true);
  });

  it('unthrottles when queue drains', () => {
    controller.initClient('client-1');

    // Throttle
    for (let i = 0; i < 60; i++) {
      controller.recordSend('client-1', false);
    }

    expect(controller.getState('client-1').isThrottled).toBe(true);

    // Simulate successful sends to drain queue (without calling canSendMessage)
    for (let i = 0; i < 40; i++) {
      controller.recordSend('client-1', true);
    }

    const state = controller.getState('client-1');
    expect(state.isThrottled).toBe(false);
    expect(state.lastUnthrottleAt).not.toBeNull();
  });

  it('returns default state for unknown client', () => {
    const state = controller.getState('unknown');
    expect(state.isThrottled).toBe(false);
    expect(state.queuedMessages).toBe(0);
  });

  it('removes client state', () => {
    controller.initClient('client-1');
    controller.removeClient('client-1');

    const state = controller.getState('client-1');
    expect(state.isThrottled).toBe(false); // Default, not stored
  });
});
