/**
 * Core Event Bus — Unified Event System
 *
 * Single source of truth for event publishing and handling.
 *
 * Per ADR-0006: Event System Consolidation
 * - All events flow through modules/reports domain
 */

// EventBus interface (production)
export {
  createEventBus,
  getEventBus,
  InMemoryEventBus,
  RedisEventBus,
} from './event-bus';
export type { EventBus, EventBusStats, EventHandler } from './event-bus';

// Kafka/NATS adapters (optional — for migration)
export {
  KafkaEventBus,
  NATSEventBus,
  createEventBusV2,
} from './kafka-nats-adapters';
export type { EventBusTransport, EventBusConfig, TransportType } from './kafka-nats-adapters';

// Schema Registry for event validation
export { schemaRegistry, registerAllEventSchemas } from './schema-registry';

// Event Ordering for sequence enforcement
export { sequenceTracker, withOrderingEnforcement } from './event-ordering';

// Domain event types (single source — services/reports)
export type { DomainEvent, DomainEventType } from '@/services/reports/domain-events';

// Legacy re-exports for backward compatibility
export {
  emitDomainEvent,
  on,
  getRegisteredEventTypes,
  getHandlerCount,
  ensureHandlersRegistered,
  registerAllEventHandlers,
} from '@/services/reports/domain-events';
