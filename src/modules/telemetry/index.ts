/**
 * Telemetry Module — DDD Bounded Context
 *
 * Re-exports from services layer during migration.
 * Future: Move to full DDD structure (domain/application/infrastructure).
 */

export {
  ingestTelemetry,
  ingestTelemetryBatch,
  getSamplingConfig,
  setSamplingConfig,
  getIngestStats,
  telemetryBuffer,
} from '@/services/telemetry/telemetry-ingestion-service';

export {
  startMqttIngestion,
  stopMqttIngestion,
} from '@/services/telemetry/mqtt-ingestion-service';
