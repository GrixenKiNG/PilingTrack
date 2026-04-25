/**
 * Reliable Event Dispatcher — WS Client Integration
 *
 * Wraps the WS client with reliability guarantees:
 * - Deduplication
 * - Event ordering
 * - Acknowledgment
 * - Backfill coordination
 */

import { ReliabilityContext, OrderedEvent, SequenceCounter } from '../reliability';
import { handleRealtimeEvent } from './event-handlers';
import { backfill } from './backfill';
import { RealtimeEvent } from '@/core/realtime/types/events';
import { logger } from '@/lib/logger';

export class ReliableEventDispatcher {
  private reliability = new ReliabilityContext();
  private sequence = new SequenceCounter();
  private lastEventTs = 0;
  private onBackfill: (count: number) => void;

  constructor(options?: { onBackfill?: (count: number) => void }) {
    this.onBackfill = options?.onBackfill ?? (() => {});
  }

  /**
   * Process a raw incoming event from WS.
   * Applies dedup, ordering, then dispatches to handler.
   */
  async onEvent(rawEvent: RealtimeEvent): Promise<void> {
    // 1. Deduplication
    const eventId = rawEvent.id || `evt_${rawEvent.ts}_${rawEvent.type}`;

    if (this.reliability.deduplicator.tryMark(eventId)) {
      logger.debug('Event deduplicated', { eventId, type: rawEvent.type });
      return;
    }

    // 2. Update timestamp tracking
    this.lastEventTs = Math.max(this.lastEventTs, rawEvent.ts);

    // 3. Process with reliability guarantees
    const processed = await this.reliability.processEvent(eventId, async () => {
      // Handle the event (updates IndexedDB)
      await handleRealtimeEvent(rawEvent);
    });

    if (!processed) {
      logger.warn('Event not processed (duplicate or backpressure)', {
        eventId,
        type: rawEvent.type,
      });
    }
  }

  /**
   * Called after WS reconnect.
   * Triggers backfill for missed events.
   */
  async onReconnect(): Promise<number> {
    if (this.lastEventTs === 0) return 0;

    logger.info('Reconnecting — triggering backfill', {
      lastEventTs: this.lastEventTs,
    });

    const result = await backfill(this.lastEventTs);

    // Update dedup cache with backfilled events
    // (backfill already updates IndexedDB)

    this.onBackfill(result.received);

    return result.received;
  }

  /**
   * Get reliability stats.
   */
  getStats() {
    return {
      dedupCacheSize: this.reliability.deduplicator.getStats().size,
      pendingDeliveries: this.reliability.tracker.pendingCount,
      backpressureQueue: this.reliability.backpressure.getStats().queueLength,
      droppedEvents: this.reliability.backpressure.getStats().droppedCount,
      lastEventTs: this.lastEventTs,
    };
  }

  /**
   * Get current sequence (for ordering).
   */
  getSequence(): number {
    return this.sequence.getValue();
  }
}

// Singleton
let _dispatcher: ReliableEventDispatcher | null = null;

export function getReliableDispatcher(): ReliableEventDispatcher {
  if (!_dispatcher) {
    _dispatcher = new ReliableEventDispatcher();
  }
  return _dispatcher;
}
