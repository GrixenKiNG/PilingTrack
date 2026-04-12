/**
 * Realtime Reliability Layer — Message Ack, Replay Buffer, Backpressure
 *
 * Solves:
 * 1. Message Ack — Client confirms receipt, server tracks unacked messages
 * 2. Replay Buffer — On reconnect, client receives missed messages
 * 3. Backpressure — Slow clients get throttled, fast clients unaffected
 *
 * Architecture:
 *
 * ┌──────────┐  ack/nack  ┌──────────────┐
 * │  Client  │◄──────────►│ MessageTracker│
 * └──────────┘            └──────┬───────┘
 *                                │
 *                         ┌──────▼───────┐
 *                         │ ReplayBuffer │ (per-client, bounded)
 *                         └──────┬───────┘
 *                                │
 *                         ┌──────▼───────┐
 *                         │ Backpressure │ (per-client queue depth)
 *                         └──────────────┘
 *
 * Protocol:
 *   Server → Client: { type: 'event', id: 'msg-123', event: {...}, seq: 42 }
 *   Client → Server: { type: 'ack', id: 'msg-123' }
 *   Client → Server: { type: 'nack', id: 'msg-123', reason: 'parse_error' }
 *   Client → Server: { type: 'replay', fromSeq: 30 }  (after reconnect)
 */

import WebSocket from 'ws';
import { RealtimeEvent } from '@/realtime/types/events';
import { logger } from '@/lib/logger';

// ============================================================
// Configuration
// ============================================================

export interface ReliabilityConfig {
  /** Max messages in replay buffer per client */
  replayBufferSize: number;
  /** Max unacked messages before backpressure kicks in */
  maxUnacked: number;
  /** Time before unacked message is considered lost (ms) */
  ackTimeoutMs: number;
  /** Max messages to replay on reconnect */
  maxReplayCount: number;
}

export const DEFAULT_RELIABILITY_CONFIG: ReliabilityConfig = {
  replayBufferSize: 500,
  maxUnacked: 50,
  ackTimeoutMs: 30000, // 30 seconds
  maxReplayCount: 200,
};

// ============================================================
// Message Tracking
// ============================================================

export interface TrackedMessage {
  id: string;
  seq: number;
  event: RealtimeEvent;
  sentAt: number;
  acked: boolean;
  ackedAt?: number;
  retries: number;
}

export class MessageTracker {
  private messages = new Map<string, TrackedMessage>();
  private sequenceCounter = 0;
  private config: ReliabilityConfig;
  private ackTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(config: ReliabilityConfig = DEFAULT_RELIABILITY_CONFIG) {
    this.config = config;
  }

  /**
   * Create a tracked message with sequence number.
   * Returns the message with metadata attached.
   */
  createMessage(event: RealtimeEvent): TrackedMessage {
    this.sequenceCounter++;

    const msg: TrackedMessage = {
      id: `msg-${crypto.randomUUID().slice(0, 8)}`,
      seq: this.sequenceCounter,
      event,
      sentAt: Date.now(),
      acked: false,
      retries: 0,
    };

    this.messages.set(msg.id, msg);

    // Set ack timeout
    const timeout = setTimeout(() => {
      if (!msg.acked) {
        this.handleAckTimeout(msg);
      }
    }, this.config.ackTimeoutMs);

    this.ackTimeouts.set(msg.id, timeout);

    return msg;
  }

  /**
   * Process client ack.
   */
  ack(messageId: string): boolean {
    const msg = this.messages.get(messageId);
    if (!msg) return false;

    msg.acked = true;
    msg.ackedAt = Date.now();

    // Clear timeout
    const timeout = this.ackTimeouts.get(messageId);
    if (timeout) {
      clearTimeout(timeout);
      this.ackTimeouts.delete(messageId);
    }

    return true;
  }

  /**
   * Process client nack.
   */
  nack(messageId: string, _reason?: string): TrackedMessage | null {
    const msg = this.messages.get(messageId);
    if (!msg) return null;

    msg.retries++;

    // Clear timeout — will be re-sent immediately
    const timeout = this.ackTimeouts.get(messageId);
    if (timeout) {
      clearTimeout(timeout);
      this.ackTimeouts.delete(messageId);
    }

    return msg;
  }

  /**
   * Get unacked messages for a client (for replay).
   */
  getUnackedMessages(fromSeq?: number): TrackedMessage[] {
    const messages: TrackedMessage[] = [];

    for (const msg of this.messages.values()) {
      if (msg.acked) continue;
      if (fromSeq !== undefined && msg.seq < fromSeq) continue;
      messages.push(msg);
    }

    return messages.sort((a, b) => a.seq - b.seq);
  }

  /**
   * Get messages in sequence range for replay.
   */
  getMessagesInRange(fromSeq: number, toSeq?: number): TrackedMessage[] {
    const messages: TrackedMessage[] = [];

    for (const msg of this.messages.values()) {
      if (msg.seq < fromSeq) continue;
      if (toSeq !== undefined && msg.seq > toSeq) break;
      messages.push(msg);
    }

    return messages
      .sort((a, b) => a.seq - b.seq)
      .slice(0, this.config.maxReplayCount);
  }

  /**
   * Get current sequence number.
   */
  getCurrentSeq(): number {
    return this.sequenceCounter;
  }

  /**
   * Get unacked message count.
   */
  getUnackedCount(): number {
    let count = 0;
    for (const msg of this.messages.values()) {
      if (!msg.acked) count++;
    }
    return count;
  }

  /**
   * Clean up old acked messages to prevent memory leak.
   */
  pruneAckedMessages(maxAgeMs = 60000): void {
    const now = Date.now();

    for (const [id, msg] of this.messages) {
      if (msg.acked && msg.ackedAt && now - msg.ackedAt > maxAgeMs) {
        this.messages.delete(id);
        const timeout = this.ackTimeouts.get(id);
        if (timeout) {
          clearTimeout(timeout);
          this.ackTimeouts.delete(id);
        }
      }
    }
  }

  /**
   * Handle ack timeout — log and evict. Previously the timeout handler
   * only removed the timer entry and left the message in `this.messages`,
   * which caused unack'd messages from disconnected clients to leak
   * forever (they were never pruned by pruneAckedMessages either, since
   * that method only removes already-acked rows).
   */
  private handleAckTimeout(msg: TrackedMessage): void {
    logger.warn('Message ack timeout', {
      messageId: msg.id,
      seq: msg.seq,
      eventType: msg.event.type,
      retries: msg.retries,
    });

    this.ackTimeouts.delete(msg.id);
    this.messages.delete(msg.id);
  }

  /**
   * Get stats.
   */
  getStats(): {
    total: number;
    acked: number;
    unacked: number;
    sequenceCounter: number;
  } {
    let acked = 0;
    let unacked = 0;

    for (const msg of this.messages.values()) {
      if (msg.acked) acked++;
      else unacked++;
    }

    return {
      total: this.messages.size,
      acked,
      unacked,
      sequenceCounter: this.sequenceCounter,
    };
  }
}

// ============================================================
// Per-Client Replay Buffer
// ============================================================

export interface ClientBuffer {
  clientId: string;
  messages: TrackedMessage[];
  lastAckedSeq: number;
  isUnderBackpressure: boolean;
}

export class ReplayBufferManager {
  private buffers = new Map<string, ClientBuffer>();
  private config: ReliabilityConfig;

  constructor(config: ReliabilityConfig = DEFAULT_RELIABILITY_CONFIG) {
    this.config = config;
  }

  /**
   * Create a new client buffer.
   */
  createBuffer(clientId: string): ClientBuffer {
    const buffer: ClientBuffer = {
      clientId,
      messages: [],
      lastAckedSeq: 0,
      isUnderBackpressure: false,
    };
    this.buffers.set(clientId, buffer);
    return buffer;
  }

  /**
   * Add a message to a client's replay buffer.
   */
  addMessage(clientId: string, message: TrackedMessage): boolean {
    const buffer = this.buffers.get(clientId);
    if (!buffer) return false;

    buffer.messages.push(message);

    // Enforce buffer size limit
    while (buffer.messages.length > this.config.replayBufferSize) {
      buffer.messages.shift();
    }

    // Check backpressure
    const unacked = buffer.messages.filter((m) => !m.acked).length;
    buffer.isUnderBackpressure = unacked > this.config.maxUnacked;

    return true;
  }

  /**
   * Ack a message in client's buffer.
   */
  ackMessage(clientId: string, messageId: string): boolean {
    const buffer = this.buffers.get(clientId);
    if (!buffer) return false;

    const msg = buffer.messages.find((m) => m.id === messageId);
    if (!msg) return false;

    msg.acked = true;
    msg.ackedAt = Date.now();

    // Update last acked seq
    if (msg.seq > buffer.lastAckedSeq) {
      buffer.lastAckedSeq = msg.seq;
    }

    // Check if backpressure is relieved
    const unacked = buffer.messages.filter((m) => !m.acked).length;
    buffer.isUnderBackpressure = unacked > this.config.maxUnacked;

    return true;
  }

  /**
   * Get messages to replay for a client after reconnect.
   */
  getReplayMessages(clientId: string, fromSeq: number): TrackedMessage[] {
    const buffer = this.buffers.get(clientId);
    if (!buffer) return [];

    return buffer.messages
      .filter((m) => m.seq > fromSeq)
      .sort((a, b) => a.seq - b.seq)
      .slice(0, this.config.maxReplayCount);
  }

  /**
   * Check if client is under backpressure.
   */
  isClientUnderBackpressure(clientId: string): boolean {
    return this.buffers.get(clientId)?.isUnderBackpressure ?? false;
  }

  /**
   * Remove a client buffer.
   */
  removeBuffer(clientId: string): void {
    this.buffers.delete(clientId);
  }

  /**
   * Get stats.
   */
  getStats(): {
    clientCount: number;
    totalBufferedMessages: number;
    clientsUnderBackpressure: number;
  } {
    let totalBuffered = 0;
    let clientsUnderBackpressure = 0;

    for (const buffer of this.buffers.values()) {
      totalBuffered += buffer.messages.length;
      if (buffer.isUnderBackpressure) clientsUnderBackpressure++;
    }

    return {
      clientCount: this.buffers.size,
      totalBufferedMessages: totalBuffered,
      clientsUnderBackpressure,
    };
  }
}

// ============================================================
// Backpressure Controller
// ============================================================

export interface BackpressureState {
  isThrottled: boolean;
  queuedMessages: number;
  lastUnthrottleAt: number | null;
}

export class BackpressureController {
  private states = new Map<string, BackpressureState>();
  private config: ReliabilityConfig;

  constructor(config: ReliabilityConfig = DEFAULT_RELIABILITY_CONFIG) {
    this.config = config;
  }

  /**
   * Initialize backpressure state for a client.
   */
  initClient(clientId: string): void {
    this.states.set(clientId, {
      isThrottled: false,
      queuedMessages: 0,
      lastUnthrottleAt: null,
    });
  }

  /**
   * Check if message should be sent or queued due to backpressure.
   * Returns true if message can be sent, false if throttled.
   */
  canSendMessage(clientId: string): boolean {
    const state = this.states.get(clientId);
    if (!state) return true;

    if (state.isThrottled) {
      state.queuedMessages++;
      return false;
    }

    return true;
  }

  /**
   * Record that a message was sent. If queue is too deep, throttle.
   */
  recordSend(clientId: string, success: boolean): void {
    const state = this.states.get(clientId);
    if (!state) return;

    if (!success && !state.isThrottled) {
      state.queuedMessages++;

      // Throttle if queue is too deep
      if (state.queuedMessages > this.config.maxUnacked) {
        state.isThrottled = true;
        logger.warn('Client throttled due to backpressure', {
          clientId,
          queuedMessages: state.queuedMessages,
        });
      }
    } else if (success) {
      state.queuedMessages = Math.max(0, state.queuedMessages - 1);

      // Unthrottle if queue is low enough
      if (state.isThrottled && state.queuedMessages < this.config.maxUnacked / 2) {
        state.isThrottled = false;
        state.lastUnthrottleAt = Date.now();
        logger.info('Client unthrottled', { clientId });
      }
    }
  }

  /**
   * Get backpressure state for a client.
   */
  getState(clientId: string): BackpressureState {
    return (
      this.states.get(clientId) ?? {
        isThrottled: false,
        queuedMessages: 0,
        lastUnthrottleAt: null,
      }
    );
  }

  /**
   * Remove client state.
   */
  removeClient(clientId: string): void {
    this.states.delete(clientId);
  }
}
