/**
 * Telemetry Module — DDD Bounded Context
 *
 * Re-exports from services layer during migration.
 * Future: Move to full DDD structure (domain/application/infrastructure).
 */

// eslint-disable-next-line no-restricted-imports -- intentional public re-export facade; implementation stays in services/ until the services->modules migration completes (CLAUDE.md)
export {
  ingestTelemetry,
  ingestTelemetryBatch,
  getSamplingConfig,
  setSamplingConfig,
  getIngestStats,
  telemetryBuffer,
} from '@/services/telemetry/telemetry-ingestion-service';

// eslint-disable-next-line no-restricted-imports -- intentional public re-export facade; implementation stays in services/ until the services->modules migration completes (CLAUDE.md)
export {
  startMqttIngestion,
  stopMqttIngestion,
} from '@/services/telemetry/mqtt-ingestion-service';
