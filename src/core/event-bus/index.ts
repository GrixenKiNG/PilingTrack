/**
 * Core Event Bus — Public API
 *
 * Per ADR-0006 (superseded by inline note 2026-05-21): the parallel
 * "modern" InMemoryEventBus / RedisEventBus / Kafka / NATS implementation
 * was retired as unused. The legacy in-process event bus in
 * services/reports/domain-events.ts is the production-active path and
 * was retained.
 *
 * What this barrel exposes:
 *   - schema-registry: event-payload validation used by all workers
 *   - emitDomainEvent / on (re-exported from services/reports/domain-events)
 *   - registerAllEventHandlers (re-exported from services/reports/event-handlers —
 *     synchronous; call once at startup, idempotent via Set-based on())
 *   - DomainEvent type
 */

export { schemaRegistry, registerAllEventSchemas } from './schema-registry';

export type { DomainEvent, DomainEventType } from '@/services/reports/domain-events';

export {
  emitDomainEvent,
  on,
  getRegisteredEventTypes,
  getHandlerCount,
} from '@/services/reports/domain-events';

export { registerAllEventHandlers } from '@/services/reports/event-handlers';
