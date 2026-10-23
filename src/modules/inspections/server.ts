/**
 * Server-only entry: read-only queries that other modules may call without
 * pulling in the inspection commands (which depend on readiness). Keeps the
 * readiness ↔ inspections import graph acyclic.
 */
export { hasPostShiftSection } from './application/queries/inspection-query.service';
