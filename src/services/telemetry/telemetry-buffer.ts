/**
 * Telemetry Buffer — Batch, Sample, Protect
 *
 * Buffers telemetry records before writing to DB to:
 * - Reduce DB write amplification (batch INSERT)
 * - Protect against DB overload (circuit breaker + drop oldest)
 * - Ensure graceful shutdown (flush on exit)
 *
 * Configuration:
 *   maxBufferSize:   Max records before forced flush (default 500)
 *   flushIntervalMs: Automatic flush interval (default 5000ms)
 *   maxBatchSize:    Max records per single INSERT (default 200)
 */

import { CircuitBreaker } from '@/core/infrastructure/circuit-breakers';
import type { Prisma } from '@/generated/postgres-client';
import type { TelemetryRecord } from '@/services/telemetry/telemetry-ingestion-service';
import { logger } from '@/lib/logger';
import { runWithTenantContext, setRequestTenantId } from '@/core/security/tenant-context';

export interface TelemetryBufferConfig {
  maxBufferSize?: number;
  flushIntervalMs?: number;
  maxBatchSize?: number;
  circuitBreaker?: CircuitBreaker;
}

interface TelemetryBufferRecord extends TelemetryRecord {
  _ingestedAt: number;
}

async function getDbClient() {
  const { db } = await import('@/lib/db');
  return db;
}

function toJsonMetadata(
  metadata: TelemetryRecord['metadata']
): Prisma.InputJsonValue | undefined {
  return metadata as Prisma.InputJsonValue | undefined;
}

/** Разложить пачку по организациям — одна транзакция на организацию. */
function groupByTenant(batch: TelemetryRecord[]): Map<string, TelemetryRecord[]> {
  const groups = new Map<string, TelemetryRecord[]>();
  for (const record of batch) {
    const key = record.tenantId;
    const bucket = groups.get(key);
    if (bucket) bucket.push(record);
    else groups.set(key, [record]);
  }
  return groups;
}

export class TelemetryBuffer {
  private buffer: TelemetryBufferRecord[] = [];
  private flushTimer: ReturnType<typeof setInterval>;
  private circuitBreaker: CircuitBreaker;
  private maxBufferSize: number;
  private flushIntervalMs: number;
  private maxBatchSize: number;

  // Stats
  private flushPromise: Promise<void> | null = null;
  private totalBuffered = 0;
  private totalFlushed = 0;
  private totalDropped = 0;

  constructor(config: TelemetryBufferConfig = {}) {
    this.maxBufferSize = config.maxBufferSize ?? 500;
    this.flushIntervalMs = config.flushIntervalMs ?? 5_000;
    this.maxBatchSize = config.maxBatchSize ?? 200;
    this.circuitBreaker = config.circuitBreaker ?? new CircuitBreaker('telemetry-db', {
      failureThreshold: 5,
      resetTimeoutMs: 30_000,
    });

    // Periodic flush
    this.flushTimer = setInterval(() => {
      this.flush().catch((err) => {
        logger.error('TelemetryBuffer: periodic flush error', err);
      });
    }, this.flushIntervalMs);

    // Unref timer so it doesn't block process exit
    if (typeof this.flushTimer.unref === 'function') {
      this.flushTimer.unref();
    }

    // Graceful shutdown
    this.registerShutdownHook();
  }

  /**
   * Ingest a single telemetry record into the buffer.
   * If buffer is full, flush immediately.
   * If DB is overloaded (circuit OPEN), drop oldest records.
   */
  async ingest(record: TelemetryRecord): Promise<void> {
    const bufferRecord: TelemetryBufferRecord = {
      ...record,
      _ingestedAt: Date.now(),
    };

    this.buffer.push(bufferRecord);
    this.totalBuffered++;

    // Check if buffer is at capacity
    if (this.buffer.length >= this.maxBufferSize) {
      // If circuit is OPEN, drop oldest to make room
      if (this.circuitBreaker.getState().state === 'OPEN') {
        this.dropOldest(Math.ceil(this.maxBufferSize * 0.25)); // drop 25%
        logger.warn('TelemetryBuffer: circuit breaker OPEN, dropped oldest records', { bufferSize: this.buffer.length });
      } else {
        await this.flush();
      }
    }
  }

  /**
   * Flush all buffered records to the database.
   * Processes in batches respecting maxBatchSize.
   */
  async flush(): Promise<void> {
    if (this.flushPromise) return this.flushPromise;
    this.flushPromise = this.flushPending().finally(() => { this.flushPromise = null; });
    return this.flushPromise;
  }

  private async flushPending(): Promise<void> {
    if (this.buffer.length === 0) return;
    // Resolve the client before taking ownership of the buffered records.
    const db = await getDbClient();
    const pending = [...groupByTenant(this.buffer).values()]
      .flatMap((records) => Array.from(
        {length: Math.ceil(records.length / this.maxBatchSize)},
        (_, i) => records.slice(i * this.maxBatchSize, (i + 1) * this.maxBatchSize),
      ));
    this.buffer = [];
    for (let i = 0; i < pending.length; i++) {
      const batch = pending[i];
      try {
        await this.circuitBreaker.execute(() => runWithTenantContext(async () => {
          setRequestTenantId(batch[0].tenantId);
          await db.$transaction(batch.map((record) => db.telemetryRecord.create({data: {
            type: record.type, tenantId: record.tenantId, equipmentId: record.equipmentId,
            siteId: record.siteId ?? null, value: record.value, unit: record.unit ?? null,
            latitude: record.latitude ?? null, longitude: record.longitude ?? null,
            ...(record.metadata !== undefined ? {metadata: toJsonMetadata(record.metadata)} : {}),
            timestamp: record.timestamp ?? new Date(),
          }})));
        }));
        this.totalFlushed += batch.length;
      } catch (error) {
        // Successful tenant batches stay committed; retry only the failed and
        // unattempted batches, including the current batch (not i + 1).
        this.buffer = [...pending.slice(i).flat().map(record => ({...record, _ingestedAt: Date.now()})), ...this.buffer];
        logger.error('TelemetryBuffer: flush failed; records retained for retry', error);
        return;
      }
    }
  }

  /**
   * Get current buffer stats.
   */
  getStats(): { buffered: number; flushed: number; dropped: number } {
    return {
      buffered: this.buffer.length,
      flushed: this.totalFlushed,
      dropped: this.totalDropped,
    };
  }

  /**
   * Get detailed stats including circuit breaker state.
   */
  getDetailedStats(): {
    buffered: number;
    flushed: number;
    dropped: number;
    totalBuffered: number;
    circuitBreakerState: string;
  } {
    return {
      buffered: this.buffer.length,
      flushed: this.totalFlushed,
      dropped: this.totalDropped,
      totalBuffered: this.totalBuffered,
      circuitBreakerState: this.circuitBreaker.getState().state,
    };
  }

  /**
   * Get circuit breaker instance for external checks.
   */
  getCircuitBreaker(): CircuitBreaker {
    return this.circuitBreaker;
  }

  /**
   * Graceful shutdown — flush remaining records.
   */
  async shutdown(): Promise<void> {
    clearInterval(this.flushTimer);
    logger.info('TelemetryBuffer: shutting down, flushing', { pending: this.buffer.length });
    await this.flush();
    logger.info('TelemetryBuffer: shutdown complete', this.getStats());
  }

  /**
   * Drop the oldest N records from the buffer.
   */
  private dropOldest(count: number): void {
    const dropped = this.buffer.splice(0, Math.min(count, this.buffer.length));
    this.totalDropped += dropped.length;
  }

  /**
   * Register process shutdown handlers for graceful flush.
   */
  private registerShutdownHook(): void {
    const shutdown = async () => {
      await this.shutdown();
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);

    // For Node.js 14+ beforeExit
    process.on('beforeExit', shutdown);
  }
}

// Singleton instance
export const telemetryBuffer = new TelemetryBuffer();
