/**
 * IIoT Telemetry Ingestion Service
 *
 * Accepts telemetry data from industrial sensors (pile drivers, drilling rigs, GPS).
 * Designed for high-throughput ingestion with batch support.
 *
 * Supported telemetry types:
 * - pile_strike: individual pile driving impacts
 * - drilling_depth: current drilling depth
 * - equipment_gps: GPS coordinates of equipment
 * - cycle_time: time measurements for operations
 *
 * Features:
 * - Probabilistic sampling (configurable rate)
 * - Adaptive sampling under high load
 * - Rate limiting (max 1000 records/sec)
 * - Buffered ingestion via TelemetryBuffer
 *
 * Usage:
 *   import { ingestTelemetry, ingestTelemetryBatch } from '@/services/telemetry/telemetry-ingestion-service';
 *
 *   // Single record:
 *   await ingestTelemetry({ type: 'pile_strike', equipmentId: 'eq-1', value: 42.5, timestamp: new Date() });
 *
 *   // Batch:
 *   await ingestTelemetryBatch(records);
 */

import { telemetryBuffer } from './telemetry-buffer';
import { logger } from '@/lib/logger';

// Re-export buffer for API layer access
export { telemetryBuffer };

export type TelemetryType =
  | 'pile_strike'
  | 'drilling_depth'
  | 'equipment_gps'
  | 'cycle_time'
  | 'pressure'
  | 'vibration'
  | 'temperature';

export interface TelemetryRecord {
  type: TelemetryType;
  tenantId: string;
  equipmentId: string;
  siteId?: string;
  value: number;
  unit?: string;
  latitude?: number;
  longitude?: number;
  metadata?: Record<string, unknown>;
  timestamp?: Date;
}

async function getDbClient() {
  const { db } = await import('@/lib/db');
  return db;
}

// --- Sampling Configuration ---

export interface SamplingConfig {
  rate: number;            // 0.0–1.0, default 1.0 (all records)
  minRate: number;         // Minimum rate under adaptive load (default 0.1)
  loadThreshold: number;   // Records/sec threshold to trigger adaptive sampling (default 500)
}

const DEFAULT_SAMPLING_CONFIG: SamplingConfig = {
  rate: 1.0,
  minRate: 0.1,
  loadThreshold: 500,
};

// --- Rate Limiting ---

const MAX_INGEST_RATE = 1000; // max records per second
let ingestCountWindow = 0;
let ingestWindowStart = Date.now();
const currentSamplingConfig: SamplingConfig = { ...DEFAULT_SAMPLING_CONFIG };

/**
 * Check if ingestion is within the rate limit.
 * Returns false if rate exceeded.
 */
function checkIngestRateLimit(): boolean {
  const now = Date.now();
  const elapsed = now - ingestWindowStart;

  // Reset window every second
  if (elapsed >= 1000) {
    ingestCountWindow = 0;
    ingestWindowStart = now;
  }

  ingestCountWindow++;
  return ingestCountWindow <= MAX_INGEST_RATE;
}

/**
 * Probabilistic sampling check.
 * Returns true if the record should be kept.
 */
function shouldSample(): boolean {
  return Math.random() < currentSamplingConfig.rate;
}

/**
 * Calculate current load (records/sec) and adjust sampling rate adaptively.
 */
function adaptSamplingRate(): void {
  const now = Date.now();
  const elapsed = (now - ingestWindowStart) / 1000;
  if (elapsed < 1) return;

  const currentRate = ingestCountWindow / elapsed;

  if (currentRate > currentSamplingConfig.loadThreshold) {
    // Reduce sampling rate proportionally, but not below minRate
    const ratio = currentSamplingConfig.loadThreshold / currentRate;
    const newRate = Math.max(
      currentSamplingConfig.minRate,
      currentSamplingConfig.rate * ratio
    );

    if (newRate < currentSamplingConfig.rate) {
      logger.warn('TelemetryIngestion: high load detected, reducing sampling rate', {
        currentRate: Number(currentRate.toFixed(0)),
        prevRate: Number(currentSamplingConfig.rate.toFixed(2)),
        newRate: Number(newRate.toFixed(2)),
      });
      currentSamplingConfig.rate = newRate;
    }
  } else if (currentRate < currentSamplingConfig.loadThreshold * 0.5 &&
             currentSamplingConfig.rate < DEFAULT_SAMPLING_CONFIG.rate) {
    // Gradually restore sampling rate when load is low
    const newRate = Math.min(
      DEFAULT_SAMPLING_CONFIG.rate,
      currentSamplingConfig.rate * 1.5
    );
    currentSamplingConfig.rate = newRate;
  }
}

/**
 * Get current sampling configuration.
 */
export function getSamplingConfig(): SamplingConfig {
  return { ...currentSamplingConfig };
}

/**
 * Set sampling configuration.
 */
export function setSamplingConfig(config: Partial<SamplingConfig>): void {
  if (config.rate !== undefined) currentSamplingConfig.rate = Math.max(0, Math.min(1, config.rate));
  if (config.minRate !== undefined) currentSamplingConfig.minRate = Math.max(0, Math.min(1, config.minRate));
  if (config.loadThreshold !== undefined) currentSamplingConfig.loadThreshold = config.loadThreshold;
}

/**
 * Get current ingest rate stats.
 */
export function getIngestStats(): {
  recordsPerSecond: number;
  currentSamplingRate: number;
  bufferStats: { buffered: number; flushed: number; dropped: number };
} {
  const recordsPerSecond = ingestCountWindow;
  return {
    recordsPerSecond,
    currentSamplingRate: currentSamplingConfig.rate,
    bufferStats: telemetryBuffer.getStats(),
  };
}

/**
 * Ingest a single telemetry record.
 *
 * Flow:
 * 1. Rate limit check (max 1000/sec)
 * 2. Probabilistic sampling
 * 3. Adaptive sampling adjustment
 * 4. Buffer for batched DB writes
 */
export async function ingestTelemetry(record: TelemetryRecord): Promise<string> {
  // Fail closed: every record must carry the writer's tenant, never inferred
  // from equipmentId alone — callers resolve and validate it first.
  if (!record.tenantId) {
    throw new Error('ingestTelemetry: tenantId is required');
  }

  // Rate limit
  if (!checkIngestRateLimit()) {
    throw new Error('Telemetry ingest rate limit exceeded (max 1000 records/sec)');
  }

  // Adaptive sampling
  adaptSamplingRate();

  // Probabilistic sampling
  if (!shouldSample()) {
    // Record sampled out — return a synthetic ID to indicate it was accepted but not stored
    return `sampled-out-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  // Buffer the record
  await telemetryBuffer.ingest(record);

  // Return a synthetic ID since the record is buffered, not immediately persisted
  return `buffered-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Ingest multiple telemetry records in a single call.
 *
 * Flow:
 * 1. Rate limit check
 * 2. Probabilistic sampling on each record
 * 3. Adaptive sampling adjustment
 * 4. Buffer all sampled records
 */
export async function ingestTelemetryBatch(
  records: TelemetryRecord[]
): Promise<number> {
  if (records.length === 0) return 0;

  // Fail closed: same per-record tenant guarantee as ingestTelemetry.
  if (records.some((r) => !r.tenantId)) {
    throw new Error('ingestTelemetryBatch: tenantId is required on every record');
  }

  // Rate limit check for batch
  if (!checkIngestRateLimit()) {
    throw new Error('Telemetry ingest rate limit exceeded (max 1000 records/sec)');
  }

  // Adaptive sampling
  adaptSamplingRate();

  let sampledCount = 0;

  for (const record of records) {
    if (shouldSample()) {
      await telemetryBuffer.ingest(record);
      sampledCount++;
    }
  }

  return sampledCount;
}

/**
 * equipmentIds that do NOT belong to tenantId — empty means every id is
 * owned by the caller's tenant. equipmentId arrives from request bodies/query
 * params, so callers must check this before writing or reading telemetry
 * against it (Equipment is the only tenant anchor TelemetryRecord has at the
 * API boundary).
 */
export async function findForeignEquipmentIds(
  tenantId: string,
  equipmentIds: string[]
): Promise<string[]> {
  if (!tenantId) {
    throw new Error('findForeignEquipmentIds: tenantId is required');
  }
  if (equipmentIds.length === 0) return [];
  const db = await getDbClient();
  const owned = await db.equipment.findMany({
    where: { id: { in: equipmentIds }, tenantId },
    select: { id: true },
  });
  const ownedSet = new Set(owned.map((e) => e.id));
  return equipmentIds.filter((id) => !ownedSet.has(id));
}

/**
 * Get latest telemetry for a specific equipment.
 */
export async function getLatestTelemetry(
  equipmentId: string,
  tenantId: string,
  type?: TelemetryType
) {
  if (!tenantId) {
    throw new Error('getLatestTelemetry: tenantId is required');
  }
  const db = await getDbClient();
  return db.telemetryRecord.findFirst({
    where: {
      equipmentId,
      tenantId,
      ...(type ? { type } : {}),
    },
    orderBy: { timestamp: 'desc' },
  });
}

/**
 * Get telemetry data for a time range.
 */
export async function getTelemetryByRange(params: {
  tenantId: string;
  equipmentId?: string;
  equipmentIds?: string[]; // restrict to this set — used for operator-scoped reads
  siteId?: string;
  type?: TelemetryType;
  from: Date;
  to: Date;
  limit?: number;
}) {
  if (!params.tenantId) {
    throw new Error('getTelemetryByRange: tenantId is required');
  }
  const db = await getDbClient();
  return db.telemetryRecord.findMany({
    where: {
      tenantId: params.tenantId,
      ...(params.equipmentId
        ? { equipmentId: params.equipmentId }
        : params.equipmentIds && params.equipmentIds.length > 0
          ? { equipmentId: { in: params.equipmentIds } }
          : {}),
      ...(params.siteId ? { siteId: params.siteId } : {}),
      ...(params.type ? { type: params.type } : {}),
      timestamp: {
        gte: params.from,
        lte: params.to,
      },
    },
    orderBy: { timestamp: 'asc' },
    take: params.limit || 1000,
  });
}

/**
 * Get aggregated telemetry stats for a time range.
 */
export async function getTelemetryStats(params: {
  tenantId: string;
  equipmentId?: string;
  siteId?: string;
  from: Date;
  to: Date;
}) {
  if (!params.tenantId) {
    throw new Error('getTelemetryStats: tenantId is required');
  }
  const db = await getDbClient();
  const where: Record<string, unknown> = {
    tenantId: params.tenantId,
    timestamp: {
      gte: params.from,
      lte: params.to,
    },
  };
  if (params.equipmentId) where.equipmentId = params.equipmentId;
  if (params.siteId) where.siteId = params.siteId;

  const result = await db.telemetryRecord.aggregate({
    where,
    _count: { id: true },
    _avg: { value: true },
    _min: { value: true, timestamp: true },
    _max: { value: true, timestamp: true },
  });

  return {
    count: result._count.id,
    avgValue: result._avg.value,
    minValue: result._min.value,
    maxValue: result._max.value,
    earliestRecord: result._min.timestamp,
    latestRecord: result._max.timestamp,
  };
}

/**
 * Per-parameter telemetry analysis for one rig over a range. Aggregates DB-side
 * (GROUP BY type) so it stays correct no matter how many readings the period
 * holds — unlike pulling raw rows and reducing in the client. Returns one row
 * per signal type with count / min / avg / max plus the latest value & unit.
 * `machine_state` is excluded (it's a state code, not a metric).
 */
export async function getTelemetryAnalysis(params: {
  tenantId: string;
  equipmentId: string;
  from: Date;
  to: Date;
}) {
  if (!params.tenantId) {
    throw new Error('getTelemetryAnalysis: tenantId is required');
  }
  const db = await getDbClient();
  const where = {
    tenantId: params.tenantId,
    equipmentId: params.equipmentId,
    timestamp: { gte: params.from, lte: params.to },
  };

  const [grouped, latest] = await Promise.all([
    db.telemetryRecord.groupBy({
      by: ['type'],
      where,
      _count: { _all: true },
      _avg: { value: true },
      _min: { value: true },
      _max: { value: true },
    }),
    db.telemetryRecord.findMany({
      where,
      distinct: ['type'],
      orderBy: { timestamp: 'desc' },
      select: { type: true, value: true, unit: true, timestamp: true },
    }),
  ]);

  const latestByType = new Map(latest.map((r) => [r.type, r]));

  return grouped
    .filter((g) => g.type !== 'machine_state')
    .map((g) => {
      const last = latestByType.get(g.type);
      return {
        type: g.type,
        count: g._count._all,
        min: g._min.value,
        avg: g._avg.value,
        max: g._max.value,
        lastValue: last?.value ?? null,
        lastTimestamp: last?.timestamp ? last.timestamp.toISOString() : null,
        unit: last?.unit ?? null,
      };
    });
}
