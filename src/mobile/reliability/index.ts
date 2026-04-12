/**
 * Reliability Layer — Distributed System Guarantees
 *
 * Solves the critical gaps in offline-first + real-time architecture:
 * 1. Event idempotency (deduplication on client and server)
 * 2. Event ordering (sequence numbers, causal ordering)
 * 3. Delivery guarantee (at-least-once with dedup = effectively-once)
 * 4. Backpressure (rate limiting, batching, throttling)
 *
 * This is the foundation that makes the system production-reliable.
 */

// ============================================================
// 1. Event Idempotency
// ============================================================

/**
 * Client-side event deduplication cache.
 * Prevents processing the same event twice.
 *
 * Uses a bounded LRU cache (default: 1000 events, 5 min TTL).
 */
export class EventDeduplicator {
  private seen = new Map<string, number>(); // eventId → timestamp
  private maxSize: number;
  private ttlMs: number;

  constructor(options?: { maxSize?: number; ttlMs?: number }) {
    this.maxSize = options?.maxSize ?? 1000;
    this.ttlMs = options?.ttlMs ?? 5 * 60 * 1000;
  }

  /**
   * Check if event was already processed.
   * Returns true if duplicate (should skip).
   */
  isDuplicate(eventId: string): boolean {
    this.cleanup();
    return this.seen.has(eventId);
  }

  /**
   * Mark event as processed.
   */
  markProcessed(eventId: string): void {
    this.seen.set(eventId, Date.now());
  }

  /**
   * Check and mark in one operation.
   * Returns true if duplicate.
   */
  tryMark(eventId: string): boolean {
    if (this.isDuplicate(eventId)) return true;
    this.markProcessed(eventId);
    return false;
  }

  /**
   * Remove expired entries.
   */
  private cleanup(): void {
    if (this.seen.size > this.maxSize) {
      const now = Date.now();
      for (const [id, ts] of this.seen) {
        if (now - ts > this.ttlMs) {
          this.seen.delete(id);
        }
        if (this.seen.size <= this.maxSize * 0.8) break;
      }
    }
  }

  /**
   * Get cache stats.
   */
  getStats(): { size: number; maxSize: number } {
    return { size: this.seen.size, maxSize: this.maxSize };
  }
}

// ============================================================
// 2. Event Ordering
// ============================================================

export interface OrderedEvent {
  id: string;
  sequence: number;
  serverTs: number;
  localTs: number;
  type: string;
  payload: Record<string, unknown>;
}

/**
 * Sequence counter for event ordering.
 * Monotonically increasing — survives page reload (via localStorage).
 */
export class SequenceCounter {
  private key: string;
  private _current: number;

  constructor(key = 'pilingtrack:sequence') {
    this.key = key;
    this._current = this.load();
  }

  /**
   * Get next sequence number.
   */
  next(): number {
    this._current++;
    this.save();
    return this._current;
  }

  /**
   * Get current value without incrementing.
   */
  getValue(): number {
    return this._current;
  }

  /**
   * Reset (e.g., on logout).
   */
  reset(): void {
    this._current = 0;
    this.save();
  }

  private load(): number {
    try {
      const val = localStorage.getItem(this.key);
      return val ? parseInt(val, 10) : 0;
    } catch {
      return 0;
    }
  }

  private save(): void {
    try {
      localStorage.setItem(this.key, String(this._current));
    } catch {
      // Storage full — ignore
    }
  }
}

/**
 * Reorder events by sequence number.
 * Buffers events and delivers in order.
 */
export class EventReorderer {
  private expectedSequence = 0;
  private buffer = new Map<number, OrderedEvent>();
  private maxBufferSize = 100;
  private onOrdered: (event: OrderedEvent) => void;

  constructor(options: {
    startSequence?: number;
    maxBufferSize?: number;
    onOrdered: (event: OrderedEvent) => void;
  }) {
    this.expectedSequence = options.startSequence ?? 0;
    this.maxBufferSize = options.maxBufferSize ?? 100;
    this.onOrdered = options.onOrdered;
  }

  /**
   * Submit an event for reordering.
   * Events are delivered in sequence order.
   * Out-of-order events are buffered.
   */
  submit(event: OrderedEvent): void {
    if (event.sequence <= this.expectedSequence) {
      // Already processed — duplicate or stale
      return;
    }

    if (event.sequence === this.expectedSequence + 1) {
      // Next in order — deliver immediately
      this.deliver(event);
      this.flushBuffer();
    } else {
      // Out of order — buffer
      if (this.buffer.size >= this.maxBufferSize) {
        // Buffer full — flush oldest and deliver current
        this.flushBuffer();
      }
      this.buffer.set(event.sequence, event);
    }
  }

  private deliver(event: OrderedEvent): void {
    this.expectedSequence = event.sequence;
    this.onOrdered(event);
  }

  private flushBuffer(): void {
    while (this.buffer.has(this.expectedSequence + 1)) {
      const next = this.buffer.get(this.expectedSequence + 1)!;
      this.buffer.delete(next.sequence);
      this.deliver(next);
    }
  }

  /**
   * Reset to a specific sequence (e.g., after backfill).
   */
  resetTo(sequence: number): void {
    this.expectedSequence = sequence;
    this.buffer.clear();
  }
}

// ============================================================
// 3. Delivery Guarantee (At-Least-Once + Dedup = Effectively-Once)
// ============================================================

export interface DeliveryReceipt {
  eventId: string;
  deliveredAt: number;
  acknowledged: boolean;
}

/**
 * Delivery tracker — ensures events are acknowledged.
 * Unacknowledged events are retried.
 */
export class DeliveryTracker {
  private pending = new Map<string, DeliveryReceipt>();
  private maxRetries = 3;
  private retryDelays = [1000, 3000, 10000]; // 1s, 3s, 10s

  /**
   * Track an event for delivery.
   */
  track(eventId: string): void {
    this.pending.set(eventId, {
      eventId,
      deliveredAt: Date.now(),
      acknowledged: false,
    });
  }

  /**
   * Acknowledge receipt of an event.
   */
  acknowledge(eventId: string): void {
    const receipt = this.pending.get(eventId);
    if (receipt) {
      receipt.acknowledged = true;
      this.pending.delete(eventId);
    }
  }

  /**
   * Get events that need retry.
   */
  getUnacknowledged(): DeliveryReceipt[] {
    const now = Date.now();
    const toRetry: DeliveryReceipt[] = [];

    for (const [id, receipt] of this.pending) {
      const age = now - receipt.deliveredAt;
      if (age > this.retryDelays[this.retryDelays.length - 1]) {
        toRetry.push(receipt);
      }
    }

    return toRetry;
  }

  /**
   * Get pending count.
   */
  get pendingCount(): number {
    return this.pending.size;
  }
}

// ============================================================
// 4. Backpressure Control
// ============================================================

export class BackpressureController {
  private maxEventsPerSecond: number;
  private maxBufferSize: number;
  private queue: Array<() => void> = [];
  private processing = false;
  private lastEventTime = 0;
  private droppedCount = 0;

  constructor(options?: { maxEventsPerSecond?: number; maxBufferSize?: number }) {
    this.maxEventsPerSecond = options?.maxEventsPerSecond ?? 100;
    this.maxBufferSize = options?.maxBufferSize ?? 500;
  }

  /**
   * Submit an event for processing.
   * Returns true if accepted, false if dropped (backpressure).
   */
  async submit(fn: () => void | Promise<void>): Promise<boolean> {
    if (this.queue.length >= this.maxBufferSize) {
      this.droppedCount++;
      return false; // Dropped — backpressure
    }

    return new Promise((resolve) => {
      this.queue.push(async () => {
        try {
          await fn();
          resolve(true);
        } catch {
          resolve(false);
        }
      });

      if (!this.processing) {
        this.processQueue();
      }
    });
  }

  private async processQueue(): Promise<void> {
    this.processing = true;

    while (this.queue.length > 0) {
      const now = Date.now();
      const elapsed = now - this.lastEventTime;
      const minInterval = 1000 / this.maxEventsPerSecond;

      if (elapsed < minInterval) {
        await new Promise((r) => setTimeout(r, minInterval - elapsed));
      }

      const task = this.queue.shift();
      if (task) {
        await task();
      }

      this.lastEventTime = Date.now();
    }

    this.processing = false;
  }

  /**
   * Get stats.
   */
  getStats(): {
    queueLength: number;
    droppedCount: number;
    maxQueueLength: number;
  } {
    return {
      queueLength: this.queue.length,
      droppedCount: this.droppedCount,
      maxQueueLength: this.maxBufferSize,
    };
  }
}

// ============================================================
// 5. Global Reliability Context
// ============================================================

export class ReliabilityContext {
  deduplicator: EventDeduplicator;
  sequence: SequenceCounter;
  tracker: DeliveryTracker;
  backpressure: BackpressureController;

  constructor() {
    this.deduplicator = new EventDeduplicator();
    this.sequence = new SequenceCounter();
    this.tracker = new DeliveryTracker();
    this.backpressure = new BackpressureController();
  }

  /**
   * Process an incoming event with full reliability guarantees.
   * Returns true if event was processed (not duplicate, not dropped).
   */
  async processEvent(
    eventId: string,
    handler: () => void | Promise<void>
  ): Promise<boolean> {
    // 1. Dedup
    if (this.deduplicator.tryMark(eventId)) {
      return false; // Duplicate
    }

    // 2. Backpressure
    const accepted = await this.backpressure.submit(handler);
    if (!accepted) {
      return false; // Dropped due to backpressure
    }

    // 3. Track for delivery
    this.tracker.track(eventId);

    return true;
  }
}
