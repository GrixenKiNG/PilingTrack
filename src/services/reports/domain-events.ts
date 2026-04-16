/**
 * Domain Events — Event Bus (in-memory, upgradable to Redis/Kafka)
 *
 * Central event bus for the application. Handlers subscribe to
 * specific event types. Events are dispatched synchronously within
 * the request, then persisted to outbox for reliable async processing.
 */

import type {
  ReportDomainEvent as DomainEvent,
  ReportDomainEventType as DomainEventType,
} from '@/modules/reports/domain';
import { logger } from '@/lib/logger';

// Re-export for convenience — aliased from the report domain types so
// existing call sites that import `DomainEvent` from this module keep
// working unchanged.
export type {
  ReportDomainEvent as DomainEvent,
  ReportDomainEventType as DomainEventType,
} from '@/modules/reports/domain';

// ============================================================
// Event Handlers Registry
// ============================================================

type EventHandler = (event: DomainEvent) => void | Promise<void>;

const handlers = new Map<string, Set<EventHandler>>();

/**
 * Register an event handler for a specific event type.
 */
export function on(eventType: string, handler: EventHandler) {
  if (!handlers.has(eventType)) {
    handlers.set(eventType, new Set());
  }
  handlers.get(eventType)!.add(handler);
  logger.debug('Event handler registered', { eventType, totalHandlers: handlers.get(eventType)!.size });
}

/**
 * Emit a domain event. Handlers are called synchronously.
 * If a handler throws, the error is logged but doesn't stop other handlers.
 */
export function emitDomainEvent(event: DomainEvent) {
  const eventHandlers = handlers.get(event.type);
  if (!eventHandlers) {
    logger.debug('No handlers for event', { eventType: event.type });
    return;
  }

  logger.info('Domain event emitted', {
    type: event.type,
    aggregateId: event.aggregateId,
    aggregateType: event.aggregateType,
    handlerCount: eventHandlers.size,
  });

  for (const handler of eventHandlers) {
    try {
      const result = handler(event);
      if (result instanceof Promise) {
        result.catch((err) => {
          logger.error(`Event handler error for ${event.type}`, err, {
            aggregateId: event.aggregateId,
          });
        });
      }
    } catch (err) {
      logger.error(`Event handler error for ${event.type}`, err, {
        aggregateId: event.aggregateId,
      });
    }
  }
}

/**
 * Get all registered event types (for diagnostics).
 */
export function getRegisteredEventTypes(): string[] {
  return Array.from(handlers.keys());
}

/**
 * Get handler count for diagnostics.
 */
export function getHandlerCount(eventType: string): number {
  return handlers.get(eventType)?.size || 0;
}

// ============================================================
// Auto-registration
// ============================================================

let handlersRegistered = false;

/**
 * Register all event handlers. Call once on server startup.
 */
export function registerAllEventHandlers() {
  if (handlersRegistered) return;

  // Import handlers lazily to avoid circular deps
  import('@/services/reports/event-handlers').then(({ registerAllEventHandlers }) => {
    registerAllEventHandlers();
    handlersRegistered = true;
    logger.info('All event handlers registered', {
      eventTypes: getRegisteredEventTypes(),
    });
  });
}

/**
 * Ensure handlers are registered (synchronous check).
 */
export function ensureHandlersRegistered() {
  if (!handlersRegistered) {
    try {
      void import('@/services/reports/event-handlers')
        .then(({ registerAllEventHandlers }) => {
          registerAllEventHandlers();
          handlersRegistered = true;
        })
        .catch(() => {
          // Handlers not available yet - will be registered on first event
        });
    } catch {
      // Handlers not available yet - will be registered on first event
    }
  }
}
