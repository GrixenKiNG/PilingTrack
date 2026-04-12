/**
 * Event Ordering Enforcement
 *
 * F15 Guarantee: Events are processed in version order.
 * Out-of-order events are detected and handled correctly.
 *
 * Architecture:
 * - Each event has a `sequence` number (monotonically increasing per aggregate)
 * - Projections track `lastProcessedSequence`
 * - Events with sequence <= lastProcessedSequence are ignored (idempotent)
 * - Events with sequence > lastProcessedSequence + 1 trigger gap detection
 */

import { logger } from '@/lib/logger';

// ============================================================
// Event Envelope with Ordering
// ============================================================

export interface OrderedEvent<T = unknown> {
  /** Unique event ID */
  id: string;

  /** Aggregate type (e.g., 'report') */
  aggregateType: string;

  /** Aggregate ID */
  aggregateId: string;

  /** Monotonically increasing sequence number per aggregate */
  sequence: number;

  /** Event type (e.g., 'ReportCreated') */
  type: string;

  /** Event payload */
  payload: T;

  /** When the event occurred */
  occurredAt: string;
}

// ============================================================
// Sequence Tracker (in-memory per process)
// ============================================================

class SequenceTracker {
  private lastSequence = new Map<string, number>(); // `${aggregateType}:${aggregateId}` → sequence

  /**
   * Check if an event can be processed (not already processed).
   */
  canProcess(event: OrderedEvent): {
    allowed: boolean;
    reason: 'ok' | 'duplicate' | 'out_of_order' | 'gap';
    expectedSequence: number;
  } {
    const key = `${event.aggregateType}:${event.aggregateId}`;
    const lastSeq = this.lastSequence.get(key) ?? 0;

    if (event.sequence < lastSeq) {
      // Out of order — event arrived after a later event was already processed
      logger.warn('Out-of-order event received', {
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        lastSequence: lastSeq,
        eventSequence: event.sequence,
      });

      return {
        allowed: false,
        reason: 'out_of_order',
        expectedSequence: lastSeq + 1,
      };
    }

    if (event.sequence === lastSeq) {
      // Already processed — idempotent (exact match)
      return {
        allowed: false,
        reason: 'duplicate',
        expectedSequence: lastSeq + 1,
      };
    }

    if (event.sequence === lastSeq + 1) {
      // Perfect order — process
      return {
        allowed: true,
        reason: 'ok',
        expectedSequence: lastSeq + 1,
      };
    }

    // event.sequence > lastSeq + 1 — gap detected
    logger.warn('Event sequence gap detected', {
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      lastSequence: lastSeq,
      eventSequence: event.sequence,
      gap: event.sequence - lastSeq - 1,
    });

    return {
      allowed: true, // Allow but warn — projections will self-heal
      reason: 'gap',
      expectedSequence: lastSeq + 1,
    };
  }

  /**
   * Mark an event as processed.
   */
  markProcessed(event: OrderedEvent): void {
    const key = `${event.aggregateType}:${event.aggregateId}`;
    const lastSeq = this.lastSequence.get(key) ?? 0;

    if (event.sequence > lastSeq) {
      this.lastSequence.set(key, event.sequence);
    }
  }

  /**
   * Get last processed sequence for an aggregate.
   */
  getLastSequence(aggregateType: string, aggregateId: string): number {
    const key = `${aggregateType}:${aggregateId}`;
    return this.lastSequence.get(key) ?? 0;
  }

  /**
   * Reset tracker for an aggregate (e.g., after replay).
   */
  reset(aggregateType: string, aggregateId: string): void {
    const key = `${aggregateType}:${aggregateId}`;
    this.lastSequence.delete(key);
  }

  /**
   * Get stats for monitoring.
   */
  getStats(): {
    trackedAggregates: number;
    maxSequence: number;
  } {
    let maxSeq = 0;
    for (const seq of this.lastSequence.values()) {
      if (seq > maxSeq) maxSeq = seq;
    }

    return {
      trackedAggregates: this.lastSequence.size,
      maxSequence: maxSeq,
    };
  }
}

// Export class for testing
export { SequenceTracker };

// Singleton
export const sequenceTracker = new SequenceTracker();

/**
 * Wrap event handler with ordering enforcement.
 *
 * Usage:
 *   const result = await withOrderingEnforcement(event, async () => {
 *     await handleEvent(event);
 *   });
 */
export async function withOrderingEnforcement<T>(
  event: OrderedEvent,
  handler: () => Promise<T>
): Promise<{ processed: boolean; reason: string; result?: T }> {
  const check = sequenceTracker.canProcess(event);

  if (!check.allowed) {
    logger.debug('Event skipped due to ordering', {
      reason: check.reason,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      eventSequence: event.sequence,
      expectedSequence: check.expectedSequence,
    });

    return {
      processed: false,
      reason: check.reason,
    };
  }

  try {
    const result = await handler();
    sequenceTracker.markProcessed(event);

    return {
      processed: true,
      reason: check.reason,
      result,
    };
  } catch (error) {
    // Don't mark as processed on error — will retry
    logger.error('Event handler failed — sequence not advanced', {
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      eventSequence: event.sequence,
      error: error instanceof Error ? error.message : String(error),
    });

    throw error;
  }
}
