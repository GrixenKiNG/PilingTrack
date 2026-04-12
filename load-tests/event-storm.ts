/**
 * Event Storm Test — PilingTrack
 *
 * Floods Redis Pub/Sub with events to test:
 * - WS server broadcast throughput
 * - Redis Pub/Sub capacity
 * - Client message delivery latency
 *
 * Target: ~1000 events/sec
 *
 * Prerequisites:
 *   - Redis running on localhost:6379 (or set REDIS_URL)
 *   - WS server running on port 3001
 *   - At least 1 WS client connected (for measuring delivery)
 *
 * Run:
 *   npx tsx load-tests/event-storm.ts
 *   npx tsx load-tests/event-storm.ts --rate 2000 --duration 30
 */

import Redis from 'ioredis';

// ============================================================
// Config
// ============================================================

interface StormConfig {
  rate: number;         // events per second
  duration: number;     // seconds
  redisUrl: string;
  tenantIds: string[];
  siteIds: string[];
  eventTypes: string[];
}

const config: StormConfig = {
  rate: parseInt(process.argv[2]) || 1000,
  duration: parseInt(process.argv[3]) || 30,
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  tenantIds: ['default', 'tenant-1', 'tenant-2'],
  siteIds: ['site-1', 'site-2', 'site-3', 'site-4', 'site-5'],
  eventTypes: [
    'report.updated',
    'report.submitted',
    'report.synced',
    'pile_work.added',
    'drilling.completed',
    'downtime.started',
    'downtime.ended',
    'crew.updated',
    'equipment.status_changed',
    'alert.triggered',
  ],
};

// ============================================================
// Stats tracker
// ============================================================

class EventStats {
  private totalPublished = 0;
  private totalErrors = 0;
  private startTime = Date.now();
  private lastReportTime = Date.now();
  private intervalSize = 1000; // report every 1s

  recordPublish() {
    this.totalPublished++;
    this.maybeReport();
  }

  recordError() {
    this.totalErrors++;
  }

  private maybeReport() {
    const now = Date.now();
    if (now - this.lastReportTime >= this.intervalSize) {
      this.report();
      this.lastReportTime = now;
    }
  }

  report() {
    const elapsed = (Date.now() - this.startTime) / 1000;
    const rate = Math.round(this.totalPublished / elapsed);
    const errorRate = this.totalPublished > 0
      ? ((this.totalErrors / this.totalPublished) * 100).toFixed(2)
      : '0.00';

    console.log(
      `[${new Date().toISOString()}] ` +
      `Events: ${this.totalPublished} | ` +
      `Rate: ${rate}/s | ` +
      `Errors: ${this.totalErrors} (${errorRate}%) | ` +
      `Elapsed: ${elapsed.toFixed(1)}s`
    );
  }

  finalReport() {
    const elapsed = (Date.now() - this.startTime) / 1000;
    const rate = Math.round(this.totalPublished / elapsed);
    console.log('\n========== EVENT STORM SUMMARY ==========');
    console.log(`Total events published:  ${this.totalPublished}`);
    console.log(`Total errors:            ${this.totalErrors}`);
    console.log(`Duration:                ${elapsed.toFixed(1)}s`);
    console.log(`Average rate:            ${rate} events/sec`);
    console.log(`Target rate:             ${config.rate} events/sec`);
    console.log(`Achievement:             ${((rate / config.rate) * 100).toFixed(1)}%`);
    console.log('==========================================\n');
  }
}

// ============================================================
// Event generators
// ============================================================

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateEvent(): Record<string, unknown> {
  const eventType = randomFrom(config.eventTypes);
  const tenantId = randomFrom(config.tenantIds);
  const siteId = randomFrom(config.siteIds);

  return {
    id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    type: eventType,
    tenantId,
    siteId,
    entity: eventType.split('.')[0],
    entityId: `entity-${Math.floor(Math.random() * 1000)}`,
    userId: `user-${Math.floor(Math.random() * 100)}`,
    payload: generatePayload(eventType),
    ts: Date.now(),
  };
}

function generatePayload(type: string): Record<string, unknown> {
  switch (type) {
    case 'report.updated':
      return {
        totalPiles: Math.floor(Math.random() * 200),
        totalDrilling: Math.floor(Math.random() * 500),
        totalDowntime: Math.floor(Math.random() * 120),
      };
    case 'pile_work.added':
      return {
        pileGradeId: `grade-${Math.floor(Math.random() * 3) + 1}`,
        count: Math.floor(Math.random() * 20) + 1,
      };
    case 'drilling.completed':
      return {
        typeId: `type-${Math.floor(Math.random() * 2) + 1}`,
        meters: Math.floor(Math.random() * 100),
      };
    case 'downtime.started':
      return {
        reasonId: `reason-${Math.floor(Math.random() * 3) + 1}`,
        duration: Math.floor(Math.random() * 60),
      };
    case 'alert.triggered':
      return {
        severity: randomFrom(['low', 'medium', 'high', 'critical']),
        message: `Alert ${Math.floor(Math.random() * 1000)}`,
      };
    default:
      return { data: Math.random() };
  }
}

// ============================================================
// Storm runner
// ============================================================

async function runStorm() {
  console.log('🌩️  Starting Event Storm Test');
  console.log(`   Rate: ${config.rate} events/sec`);
  console.log(`   Duration: ${config.duration}s`);
  console.log(`   Redis: ${config.redisUrl}`);
  console.log(`   Event types: ${config.eventTypes.length}`);
  console.log('');

  const redis = new Redis(config.redisUrl, {
    lazyConnect: false,
    retryStrategy: (times) => Math.min(times * 100, 3000),
    maxRetriesPerRequest: 3,
  });

  redis.on('connect', () => console.log('✅ Redis connected'));
  redis.on('error', (err) => console.error('❌ Redis error:', err.message));

  const stats = new EventStats();
  const CHANNEL = 'realtime:events';

  // Calculate batch interval to achieve target rate
  const batchSize = 10; // events per batch
  const intervalMs = (batchSize / config.rate) * 1000;

  console.log(`   Batch size: ${batchSize}`);
  console.log(`   Interval: ${intervalMs.toFixed(2)}ms`);
  console.log('');

  const stormInterval = setInterval(async () => {
    try {
      const events = Array.from({ length: batchSize }, () => generateEvent());

      // Publish all events in parallel
      const promises = events.map((event) =>
        redis.publish(CHANNEL, JSON.stringify(event))
      );

      await Promise.all(promises);

      for (let i = 0; i < events.length; i++) {
        stats.recordPublish();
      }
    } catch (err) {
      const count = Math.min(batchSize, 10);
      for (let i = 0; i < count; i++) {
        stats.recordError();
      }
    }
  }, intervalMs);

  // Stop after duration
  await new Promise<void>((resolve) => {
    setTimeout(() => {
      clearInterval(stormInterval);
      resolve();
    }, config.duration * 1000);
  });

  stats.finalReport();

  await redis.quit();
  process.exit(0);
}

// ============================================================
// Entry
// ============================================================

runStorm().catch((err) => {
  console.error('Storm failed:', err);
  process.exit(1);
});
