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
 * Emit a domain event. Awaits all handlers (in parallel via Promise.allSettled
 * so a slow/failing one doesn't block the rest), then re-throws if any rejected.
 *
 * Re-throwing is critical: callers like the outbox publisher catch this and
 * use it to drive their retry/DLQ logic. Swallowing handler errors here used
 * to make the outbox think every event was processed successfully, even
 * when projections silently failed — attempts never incremented, DLQ never
 * received anything, and read models drifted out of sync without alerts.
 *
 * Handlers that legitimately should NOT fail the event (e.g. Telegram
 * notifications, audit logging) MUST swallow their own errors internally.
 * Critical handlers (analytics projections, daily summary) MUST propagate.
 */
export async function emitDomainEvent(event: DomainEvent): Promise<void> {
  const normalizedType = normalizeReportDomainEventType(event.type) || event.type;
  const normalizedEvent =
    normalizedType === event.type ? event : { ...event, type: normalizedType };
  const eventHandlers = handlers.get(normalizedType);
  if (!eventHandlers || eventHandlers.size === 0) {
    // No subscribers — log as warn so silent gaps in registration are visible
    // by default. Previously this was debug-under-env-flag, which is how
    // 11 projection events vanished in production on 2026-05-20 with no trace.
    logger.warn('No handlers for domain event', {
      type: normalizedType,
      aggregateId: normalizedEvent.aggregateId,
    });
    return;
  }

  logger.info('Domain event emitted', {
    type: normalizedType,
    aggregateId: normalizedEvent.aggregateId,
    aggregateType: normalizedEvent.aggregateType,
    handlerCount: eventHandlers.size,
  });

  const results = await Promise.allSettled(
    Array.from(eventHandlers).map((handler) =>
      Promise.resolve().then(() => handler(normalizedEvent)),
    ),
  );

  const failures = results
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map((r) => r.reason);

  if (failures.length === 0) return;

  for (const err of failures) {
    logger.error(`Event handler error for ${normalizedType}`, err, {
      aggregateId: normalizedEvent.aggregateId,
    });
  }

  if (failures.length === 1) {
    throw failures[0];
  }
  throw new AggregateError(
    failures,
    `${failures.length} handlers failed for ${normalizedType}`,
  );
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
