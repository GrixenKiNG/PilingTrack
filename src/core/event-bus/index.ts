/**
 * Core Event Bus — Public API
 *
 * Per ADR-0006 (superseded by inline note 2026-05-21): the parallel
 * "modern" InMemoryEventBus / RedisEventBus / Kafka / NATS implementation
 * was retired as unused. The in-process event bus (emitDomainEvent / on) is the
 * production-active path and lives in modules/reports/application/domain-events.ts;
 * import it from @/modules/reports/server (core must not depend on modules).
 *
 * What this barrel exposes:
 *   - schema-registry: event-payload validation used by all workers
 */

export { schemaRegistry, registerAllEventSchemas } from './schema-registry';
