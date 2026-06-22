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
 *   - DomainEvent type
 *
 * NOTE: registerAllEventHandlers is intentionally NOT re-exported here.
 * Every caller imports it directly from @/services/reports/event-handlers,
 * so the barrel re-export was dead weight AND a core→services layer
 * violation. Import it from services directly.
 */

export { schemaRegistry, registerAllEventSchemas } from './schema-registry';

// eslint-disable-next-line no-restricted-imports -- intentional public re-export facade; implementation stays in services/ until the services->modules migration completes (CLAUDE.md)
export type { DomainEvent, DomainEventType } from '@/services/reports/domain-events';

// eslint-disable-next-line no-restricted-imports -- intentional public re-export facade; implementation stays in services/ until the services->modules migration completes (CLAUDE.md)
export {
  emitDomainEvent,
  on,
  getRegisteredEventTypes,
  getHandlerCount,
} from '@/services/reports/domain-events';
