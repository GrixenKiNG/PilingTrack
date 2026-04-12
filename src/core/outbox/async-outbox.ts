/**
 * Async Outbox — In-Memory Queue
 *
 * Defers outbox event writes to reduce transaction latency.
 * Events are batched and flushed periodically.
 *
 * Without Redis, we use an in-memory queue with periodic flush.
 * For multi-instance deployments, switch to BullMQ + Redis.
 *
 * Usage:
 *   import { asyncOutbox } from '@/core/outbox/async-outbox';
 *   await asyncOutbox.enqueue(eventData);
 */

import { db } from '@/lib/db';
import { logger } from '@/lib/logger';

interface OutboxEvent {
  type: string;
  aggregateId: string;
  aggregateType: string;
  payload: Record<string, unknown>;
  occurredAt?: string; // Optional — defaults to now
}

interface AsyncOutboxConfig {
  flushIntervalMs: number;   // How often to flush (default: 1000ms)
  maxBatchSize: number;       // Max events per flush (default: 50)
  enabled: boolean;           // Toggle async mode
}

const DEFAULT_CONFIG: AsyncOutboxConfig = {
  flushIntervalMs: 1000,
  maxBatchSize: 50,
  enabled: true,
};

class AsyncOutbox {
  private queue: OutboxEvent[] = [];
  private config: AsyncOutboxConfig;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;
  private totalFlushed = 0;
  private totalQueued = 0;

  constructor(config: Partial<AsyncOutboxConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Enqueue an outbox event (non-blocking).
   * Call this instead of db.outboxEvent.create() inside transactions.
   */
  enqueue(event: OutboxEvent): void {
    if (!this.config.enabled) {
      // Fallback: write synchronously
      this.writeSync([event]);
      return;
    }

    this.queue.push(event);
    this.totalQueued++;

    // Flush immediately if batch is full
    if (this.queue.length >= this.config.maxBatchSize) {
      this.flush().catch((err) => {
        logger.error('AsyncOutbox: flush error', err);
      });
    }
  }

  /**
   * Flush all pending events to the database.
   */
  async flush(): Promise<number> {
    if (this.flushing || this.queue.length === 0) return 0;

    this.flushing = true;
    const batch = this.queue.splice(0, this.config.maxBatchSize);

    try {
      await this.writeSync(batch);
      this.totalFlushed += batch.length;
      return batch.length;
    } catch (error) {
      // Re-queue failed events at the front
      this.queue.unshift(...batch);
      logger.error('AsyncOutbox: failed to flush, events re-queued', error);
      return 0;
    } finally {
      this.flushing = false;
    }
  }

  /**
   * Write events synchronously (used as fallback and for flush).
   */
  private async writeSync(events: OutboxEvent[]): Promise<void> {
    if (events.length === 0) return;

    try {
      await db.outboxEvent.createMany({
        data: events.map((e) => ({
          type: e.type,
          aggregateId: e.aggregateId,
          aggregateType: e.aggregateType,
          payload: e.payload as any,
          occurredAt: e.occurredAt ? new Date(e.occurredAt) : new Date(),
        })),
      });
    } catch (error) {
      logger.error('AsyncOutbox: writeSync failed', error);
      throw error;
    }
  }

  /**
   * Start the periodic flush timer.
   */
  start(): void {
    if (this.flushTimer) return; // Already running

    this.flushTimer = setInterval(() => {
      this.flush().catch((err) => {
        logger.error('AsyncOutbox: periodic flush error', err);
      });
    }, this.config.flushIntervalMs);

    logger.info('AsyncOutbox: started', {
      flushIntervalMs: this.config.flushIntervalMs,
      maxBatchSize: this.config.maxBatchSize,
    });
  }

  /**
   * Stop the periodic flush and flush remaining events.
   */
  async stop(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // Final flush
    let remaining = this.queue.length;
    while (remaining > 0) {
      const flushed = await this.flush();
      if (flushed === 0) break; // Nothing flushed — give up
      remaining = this.queue.length;
    }

    logger.info('AsyncOutbox: stopped', {
      totalQueued: this.totalQueued,
      totalFlushed: this.totalFlushed,
      remainingInQueue: remaining,
    });
  }

  /**
   * Get current queue stats.
   */
  getStats() {
    return {
      queueLength: this.queue.length,
      totalQueued: this.totalQueued,
      totalFlushed: this.totalFlushed,
      flushing: this.flushing,
      enabled: this.config.enabled,
    };
  }
}

// Singleton instance
export const asyncOutbox = new AsyncOutbox({
  flushIntervalMs: 500,  // Flush every 500ms for lower latency
  maxBatchSize: 100,
  enabled: process.env.ASYNC_OUTBOX !== 'false',
});

// Auto-start on import (in Node.js environment)
if (typeof process !== 'undefined' && process.env.NODE_ENV !== 'test') {
  asyncOutbox.start();

  // Graceful shutdown
  process.on('SIGTERM', () => {
    asyncOutbox.stop().catch(console.error);
  });
  process.on('SIGINT', () => {
    asyncOutbox.stop().catch(console.error);
  });
}

export type { OutboxEvent };
