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
import { normalizeReportDomainEventType } from '@/modules/reports/domain';
import { logger } from '@/lib/logger';

function shouldLogHandlerRegistration(): boolean {
  return process.env.LOG_HANDLER_REGISTRATION === 'true';
}

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
  const normalizedEventType = normalizeReportDomainEventType(eventType) || eventType;
  if (!handlers.has(normalizedEventType)) {
    handlers.set(normalizedEventType, new Set());
  }
  handlers.get(normalizedEventType)!.add(handler);
  if (shouldLogHandlerRegistration()) {
    logger.debug('Event handler registered', {
      eventType: normalizedEventType,
      totalHandlers: handlers.get(normalizedEventType)!.size,
    });
  }
}

/**
 * Emit a domain event. Handlers are called synchronously.
 * If a handler throws, the error is logged but doesn't stop other handlers.
 */
export function emitDomainEvent(event: DomainEvent) {
  const normalizedType = normalizeReportDomainEventType(event.type) || event.type;
  const normalizedEvent =
    normalizedType === event.type ? event : { ...event, type: normalizedType };
  const eventHandlers = handlers.get(normalizedType);
  if (!eventHandlers) {
    if (process.env.LOG_UNHANDLED_EVENTS === 'true') {
      logger.debug('No handlers for event', { eventType: normalizedType });
    }
    return;
  }

  logger.info('Domain event emitted', {
    type: normalizedType,
    aggregateId: normalizedEvent.aggregateId,
    aggregateType: normalizedEvent.aggregateType,
    handlerCount: eventHandlers.size,
  });

  for (const handler of eventHandlers) {
    try {
      const result = handler(normalizedEvent);
      if (result instanceof Promise) {
        result.catch((err) => {
          logger.error(`Event handler error for ${normalizedType}`, err, {
            aggregateId: normalizedEvent.aggregateId,
          });
        });
      }
    } catch (err) {
      logger.error(`Event handler error for ${normalizedType}`, err, {
        aggregateId: normalizedEvent.aggregateId,
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
    if (shouldLogHandlerRegistration()) {
      logger.info('All event handlers registered', {
        eventTypes: getRegisteredEventTypes(),
      });
    }
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
