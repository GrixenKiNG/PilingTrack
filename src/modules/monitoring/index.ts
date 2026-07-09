/**
 * Monitoring Module — DDD Bounded Context
 *
 * Read-only aggregations across the fleet for the /monitoring dashboard.
 * Live telemetry from physical devices ingests via the existing telemetry
 * module; this module only consumes already-persisted state.
 */

export { getFleetSnapshot } from './application/queries/fleet-monitoring.service';
export type {
  FleetSnapshot,
  FleetCard,
  EquipmentStatus,
  FleetSnapshotOptions,
} from './application/queries/fleet-monitoring.service';

export { getTemplate, saveTemplate } from './application/template-service';
