/**
 * Reports Event Bus — Delegating to Core EventBus
 *
 * This module delegates all event operations to the core EventBus
 * (InMemoryEventBus or RedisEventBus). Handlers registered here
 * are actually registered in the core bus, ensuring all events
 * flow through a single unified pipeline.
 *
 * Legacy: Previously this was a standalone in-memory bus with local
 * handler registry. Now it's a thin adapter over the core bus.
 */

import { ReportDomainEvent } from '../domain';
import { getEventBus } from '@/core/event-bus/event-bus';

/**
 * Register an event handler for a specific event type.
 * Delegates to the core EventBus.subscribe().
 */
export function on(eventType: string, handler: (event: ReportDomainEvent) => void | Promise<void>) {
  const coreBus = getEventBus();
  coreBus.subscribe(eventType, handler);
}

/**
 * Emit a domain event. Delegates to the core EventBus.publish().
 */
export async function emitDomainEvent(event: ReportDomainEvent): Promise<void> {
  const coreBus = getEventBus();
  await coreBus.publish(event);
}

/**
 * Get registered event types (diagnostics).
 * Delegates to the core EventBus.getStats().
 */
export function getRegisteredEventTypes(): string[] {
  const coreBus = getEventBus();
  const stats = coreBus.getStats();
  return Array.from(stats.handlersCount.keys());
}
