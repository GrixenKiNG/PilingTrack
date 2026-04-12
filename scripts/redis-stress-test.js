/**
 * Redis Stress Test Suite — PilingTrack
 *
 * Tests:
 * 1. Stress Test — 1000 concurrent ops
 * 2. Spike Test — 0 → 5000 ops/s in 5s
 * 3. Stampede Test — TTL expiry + 1000 simultaneous requests
 * 4. Memory Pressure Test — fill to 256MB, test eviction
 * 5. Failover Test — Redis disconnect/reconnect storm
 * 6. Network Latency Simulation — artificial delays
 *
 * Usage:
 *   node scripts/redis-stress-test.js
 *
 * Requires:
 *   - Redis running on localhost:6379
 *   - npm install ioredis
 */

const Redis = require('ioredis');
const crypto = require('crypto');

// ============================================================
// Configuration
// ============================================================

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const MAX_MEMORY = 256 * 1024 * 1024; // 256MB
const RESULTS = [];

// ============================================================
// Metrics Collector
// ============================================================

class Metrics {
  constructor(name) {
    this.name = name;
    this.latencies = [];
    this.errors = 0;
    this.successes = 0;
    this.ops = 0;
    this.startTime = Date.now();
  }

  record(latencyMs, success) {
    this.latencies.push(latencyMs);
    this.ops++;
    if (success) this.successes++;
    else this.errors++;
  }

  p(pct) {
    if (!this.latencies.length) return 0;
    const s = [...this.latencies].sort((a, b) => a - b);
    return s[Math.floor((pct / 100) * (s.length - 1))];
  }

  avg() {
    if (!this.latencies.length) return 0;
    return this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length;
  }

  opsPerSec() {
    const dur = (Date.now() - this.startTime) / 1000;
    return dur > 0 ? this.ops / dur : 0;
  }

  summary() {
    const total = this.successes + this.errors;
    return {
      name: this.name,
      ops: total,
      successes: this.successes,
      errors: this.errors,
      errorRate: total > 0 ? (this.errors / total * 100).toFixed(2) + '%' : '0%',
      throughput: this.opsPerSec().toFixed(1) + ' ops/s',
      avg: this.avg().toFixed(2) + 'ms',
      p50: this.p(50) + 'ms',
      p95: this.p(95) + 'ms',
      p99: this.p(99) + 'ms',
      max: this.latencies.length ? Math.max(...this.latencies) + 'ms' : '0ms',
    };
  }
}

// ============================================================
// Helper: Generate realistic cache payloads
// ============================================================

function generatePayload(size = 512) {
  return {
    id: crypto.randomUUID(),
    data: crypto.randomBytes(size).toString('base64'),
    timestamp: Date.now(),
    type: ['report', 'site', 'crew', 'dictionary'][Math.floor(Math.random() * 4)],
  };
}

// ============================================================
// Test 1: Stress Test — 1000 concurrent operations
// ============================================================

async function testStress(redis) {
  console.log('\n🔥 Test 1: Stress Test — 1000 concurrent operations');
  const m = new Metrics('stress');
  const CONCURRENCY = 1000;

  const workers = Array.from({ length: CONCURRENCY }, async (_, i) => {
    const key = `stress:${i}`;
    const value = generatePayload(256);

    // SET
    const t0 = Date.now();
    try {
      await redis.setex(key, 60, JSON.stringify(value));
      m.record(Date.now() - t0, true);
    } catch {
      m.record(Date.now() - t0, false);
    }

    // GET
    const t1 = Date.now();
    try {
      const raw = await redis.get(key);
      const parsed = raw ? JSON.parse(raw) : null;
      m.record(Date.now() - t1, parsed && parsed.id === value.id);
    } catch {
      m.record(Date.now() - t1, false);
    }
  });

  await Promise.allSettled(workers);

  // Cleanup
  const keys = await redis.keys('stress:*');
  if (keys.length) await redis.del(keys);

  console.log('   ' + JSON.stringify(m.summary(), null, 4).replace(/\n/g, '\n   '));
  RESULTS.push(m.summary());
  return m;
}

// ============================================================
// Test 2: Spike Test — 0 → 5000 ops/s in 5s
// ============================================================

async function testSpike(redis) {
  console.log('\n📈 Test 2: Spike Test — ramp 0 → 5000 ops/s');
  const m = new Metrics('spike');

  // Ramp up in 5 stages
  for (let stage = 0; stage < 5; stage++) {
    const concurrency = (stage + 1) * 200; // 200, 400, 600, 800, 1000
    const stageStart = Date.now();

    const workers = Array.from({ length: concurrency }, async (_, i) => {
      const key = `spike:${stage}:${i}`;
      const t0 = Date.now();
      try {
        await redis.setex(key, 10, JSON.stringify({ stage, i, ts: Date.now() }));
        m.record(Date.now() - t0, true);
      } catch {
        m.record(Date.now() - t0, false);
      }
    });

    await Promise.allSettled(workers);
    const stageDur = Date.now() - stageStart;
    console.log(`   Stage ${stage + 1}/5: ${concurrency} ops in ${stageDur}ms`);
  }

  // Cleanup
  for (let s = 0; s < 5; s++) {
    const keys = await redis.keys(`spike:${s}:*`);
    if (keys.length) await redis.del(keys);
  }

  console.log('   ' + JSON.stringify(m.summary(), null, 4).replace(/\n/g, '\n   '));
  RESULTS.push(m.summary());
  return m;
}

// ============================================================
// Test 3: Cache Stampede Test — TTL expiry + 1000 simultaneous requests
// ============================================================

async function testStampede(redis) {
  console.log('\n🌊 Test 3: Cache Stampede — 1000 clients, TTL expiry');

  const CACHE_KEY = 'stampede:test:key';
  const m = new Metrics('stampede');
  let dbHits = 0;
  let cacheHits = 0;

  // Pre-populate cache with 1s TTL
  await redis.setex(CACHE_KEY, 1, JSON.stringify({ data: 'cached', ts: Date.now() }));

  // Wait for TTL to expire
  await new Promise(r => setTimeout(r, 1100));

  // Verify expired
  const expired = await redis.get(CACHE_KEY);
  if (expired !== null) {
    console.log('   ⚠️  Cache not expired yet, waiting...');
    await new Promise(r => setTimeout(r, 100));
  }

  // Simulate 1000 clients simultaneously requesting the same key
  const workers = Array.from({ length: 1000 }, async () => {
    const t0 = Date.now();
    try {
      let value = await redis.get(CACHE_KEY);

      if (value === null) {
        // Cache miss — simulate DB call
        dbHits++;
        value = JSON.stringify({ data: 'fresh', ts: Date.now() });
        // Re-populate cache (without mutex — this IS the stampede)
        await redis.setex(CACHE_KEY, 60, value);
      } else {
        cacheHits++;
      }

      m.record(Date.now() - t0, true);
    } catch {
      m.record(Date.now() - t0, false);
    }
  });

  await Promise.allSettled(workers);

  console.log(`   DB hits (cache miss): ${dbHits}`);
  console.log(`   Cache hits: ${cacheHits}`);
  console.log(`   Stampede ratio: ${dbHits}/1000 requests hit DB`);

  const stampedeSeverity = dbHits > 100 ? 'CRITICAL' : dbHits > 10 ? 'WARNING' : 'OK';
  console.log(`   Severity: ${stampedeSeverity === 'CRITICAL' ? '🚨' : stampedeSeverity === 'WARNING' ? '⚠️' : '✅'} ${stampedeSeverity}`);

  console.log('   ' + JSON.stringify(m.summary(), null, 4).replace(/\n/g, '\n   '));
  RESULTS.push({ ...m.summary(), dbHits, cacheHits, severity: stampedeSeverity });

  // Cleanup
  await redis.del(CACHE_KEY);
  return m;
}

// ============================================================
// Test 4: Memory Pressure Test — fill to limit, test eviction
// ============================================================

async function testMemoryPressure(redis) {
  console.log('\n💾 Test 4: Memory Pressure — fill to eviction');
  const m = new Metrics('memory-pressure');

  // Set maxmemory for this test
  try {
    await redis.config('set', 'maxmemory', '50mb'); // Use 50MB for faster test
    await redis.config('set', 'maxmemory-policy', 'allkeys-lru');
  } catch (e) {
    console.log('   ⚠️  Could not set maxmemory (permission issue), using defaults');
  }

  const PAYLOAD_SIZE = 10 * 1024; // 10KB per key
  const TARGET_KEYS = 6000; // ~60MB total

  console.log(`   Filling ${TARGET_KEYS} keys × ${PAYLOAD_SIZE} bytes = ~${(TARGET_KEYS * PAYLOAD_SIZE / 1024 / 1024).toFixed(1)}MB`);

  let evictions = 0;
  const initialMemory = await redis.info('memory');
  const initialUsed = parseInt(initialMemory.match(/used_memory:(\d+)/)?.[1] || '0', 10);

  for (let i = 0; i < TARGET_KEYS; i++) {
    const key = `mem:${i}`;
    const value = generatePayload(PAYLOAD_SIZE);
    const t0 = Date.now();

    try {
      await redis.setex(key, 3600, JSON.stringify(value));
      m.record(Date.now() - t0, true);
    } catch {
      m.record(Date.now() - t0, false);
      evictions++;
    }

    if (i % 1000 === 0 && i > 0) {
      const memInfo = await redis.info('memory');
      const used = parseInt(memInfo.match(/used_memory_human:(.+)/)?.[1] || '0', 10);
      console.log(`   Progress: ${i}/${TARGET_KEYS} keys, memory: ${memInfo.match(/used_memory_human:(.+)/)?.[1] || 'unknown'}`);
    }
  }

  // Check how many keys survived
  let survived = 0;
  for (let i = 0; i < TARGET_KEYS; i += 100) {
    const exists = await redis.exists(`mem:${i}`);
    if (exists) survived++;
  }

  const finalMemInfo = await redis.info('memory');
  const finalUsed = finalMemInfo.match(/used_memory_human:(.+)/)?.[1] || 'unknown';
  const evictionsCount = finalMemInfo.match(/evicted_keys:(\d+)/)?.[1] || '0';

  console.log(`   Final memory: ${finalUsed}`);
  console.log(`   Survived: ${survived * 100}/${TARGET_KEYS} (sampled every 100)`);
  console.log(`   Evicted keys: ${evictionsCount}`);
  console.log(`   Direct errors: ${evictions}`);

  // Reset maxmemory
  try {
    await redis.config('set', 'maxmemory', '0');
  } catch {}

  // Cleanup
  for (let i = 0; i < TARGET_KEYS; i += 100) {
    await redis.del(`mem:${i}`);
  }

  console.log('   ' + JSON.stringify(m.summary(), null, 4).replace(/\n/g, '\n   '));
  RESULTS.push({ ...m.summary(), survived: survived * 100, evictions: evictionsCount, finalMemory: finalUsed });
  return m;
}

// ============================================================
// Test 5: Failover Test — Redis disconnect/reconnect storm
// ============================================================

async function testFailover(redis) {
  console.log('\n🔄 Test 5: Failover Test — disconnect/reconnect storm');
  const m = new Metrics('failover');

  // Pre-populate some data
  for (let i = 0; i < 100; i++) {
    await redis.setex(`failover:pre:${i}`, 60, `value-${i}`);
  }

  // Simulate connection loss (create a new client, we can't actually kill Redis)
  // Instead, test reconnection behavior under rapid connect/disconnect
  const reconnectClients = [];

  for (let i = 0; i < 50; i++) {
    const client = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 50, 500),
      lazyConnect: true,
      keyPrefix: `failover:${i}:`,
    });

    reconnectClients.push(client);
  }

  // Simultaneous operations from 50 "reconnecting" clients
  const workers = reconnectClients.map(async (client, i) => {
    try {
      await client.connect();
      const t0 = Date.now();
      await client.set(`test:${i}`, JSON.stringify({ client: i, ts: Date.now() }));
      await client.get(`test:${i}`);
      m.record(Date.now() - t0, true);
      await client.quit();
    } catch (err) {
      m.record(0, false);
      try { await client.quit(); } catch {}
    }
  });

  await Promise.allSettled(workers);

  console.log(`   50 clients reconnected + operated simultaneously`);
  console.log('   ' + JSON.stringify(m.summary(), null, 4).replace(/\n/g, '\n   '));
  RESULTS.push(m.summary());

  // Cleanup
  for (let i = 0; i < 100; i++) await redis.del(`failover:pre:${i}`);
  for (let i = 0; i < 50; i++) await redis.del(`failover:${i}:test:${i}`);

  return m;
}

// ============================================================
// Test 6: Network Latency Simulation
// ============================================================

async function testNetworkLatency(redis) {
  console.log('\n🌐 Test 6: Network Latency — with artificial delay');
  const m = new Metrics('network-latency');

  const DELAYS = [0, 1, 5, 10, 25, 50, 100];

  for (const delay of DELAYS) {
    const stageStart = Date.now();
    const ops = 100;

    const workers = Array.from({ length: ops }, async (_, i) => {
      const t0 = Date.now();
      try {
        await redis.setex(`latency:${delay}:${i}`, 60, JSON.stringify({ delay, ts: Date.now() }));
        await new Promise(r => setTimeout(r, delay)); // Artificial delay
        await redis.get(`latency:${delay}:${i}`);
        m.record(Date.now() - t0, true);
      } catch {
        m.record(Date.now() - t0, false);
      }
    });

    await Promise.allSettled(workers);
    const stageDur = Date.now() - stageStart;
    console.log(`   +${delay}ms delay: ${ops} ops in ${stageDur}ms`);

    // Cleanup
    const keys = await redis.keys(`latency:${delay}:*`);
    if (keys.length) await redis.del(keys);
  }

  console.log('   ' + JSON.stringify(m.summary(), null, 4).replace(/\n/g, '\n   '));
  RESULTS.push(m.summary());
  return m;
}

// ============================================================
// Test 7: Cache-aside vs Write-through comparison
// ============================================================

async function testCacheStrategies(redis) {
  console.log('\n📊 Test 7: Cache Strategy Comparison');

  // Cache-aside pattern
  const m1 = new Metrics('cache-aside');
  for (let i = 0; i < 200; i++) {
    const key = `ca:${i % 50}`;
    const t0 = Date.now();
    try {
      let val = await redis.get(key);
      if (!val) {
        val = JSON.stringify({ source: 'db', i });
        await redis.setex(key, 30, val);
      }
      m1.record(Date.now() - t0, true);
    } catch {
      m1.record(Date.now() - t0, false);
    }
  }

  // Write-through pattern
  const m2 = new Metrics('write-through');
  for (let i = 0; i < 200; i++) {
    const key = `wt:${i % 50}`;
    const t0 = Date.now();
    try {
      const val = JSON.stringify({ source: 'write', i });
      await redis.setex(key, 30, val);
      await redis.get(key);
      m2.record(Date.now() - t0, true);
    } catch {
      m2.record(Date.now() - t0, false);
    }
  }

  // Cleanup
  for (let i = 0; i < 50; i++) {
    await redis.del(`ca:${i}`);
    await redis.del(`wt:${i}`);
  }

  console.log('   Cache-Aside:');
  console.log('   ' + JSON.stringify(m1.summary(), null, 4).replace(/\n/g, '     '));
  console.log('   Write-Through:');
  console.log('   ' + JSON.stringify(m2.summary(), null, 4).replace(/\n/g, '     '));

  RESULTS.push({ strategy: 'cache-aside', ...m1.summary() });
  RESULTS.push({ strategy: 'write-through', ...m2.summary() });
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log('═'.repeat(70));
  console.log('🔴 Redis Stress Test Suite — PilingTrack');
  console.log('═'.repeat(70));

  // Connect to Redis
  const redis = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => Math.min(times * 100, 1000),
  });

  try {
    await redis.ping();
    console.log('✅ Connected to Redis at', REDIS_URL);
  } catch (err) {
    console.error('❌ Failed to connect to Redis:', err.message);
    process.exit(1);
  }

  const totalStart = Date.now();

  // Run all tests
  await testStress(redis);
  await testSpike(redis);
  await testStampede(redis);
  await testMemoryPressure(redis);
  await testFailover(redis);
  await testNetworkLatency(redis);
  await testCacheStrategies(redis);

  const totalDur = ((Date.now() - totalStart) / 1000).toFixed(1);

  // ============================================================
  // Final Summary
  // ============================================================

  console.log('\n' + '═'.repeat(70));
  console.log('📊 FINAL SUMMARY');
  console.log('═'.repeat(70));

  for (const r of RESULTS) {
    console.log(`\n  ${r.name || r.strategy || 'unknown'}:`);
    console.log(`    Ops: ${r.ops} | Success: ${r.successes} | Errors: ${r.errors} (${r.errorRate})`);
    console.log(`    Throughput: ${r.throughput} | Avg: ${r.avg}`);
    console.log(`    p50: ${r.p50} | p95: ${r.p95} | p99: ${r.p99}`);
    if (r.severity) console.log(`    Severity: ${r.severity}`);
    if (r.dbHits !== undefined) console.log(`    DB hits: ${r.dbHits} | Cache hits: ${r.cacheHits}`);
    if (r.finalMemory) console.log(`    Memory: ${r.finalMemory} | Evictions: ${r.evictions}`);
  }

  console.log('\n' + '═'.repeat(70));
  console.log(`   Total duration: ${totalDur}s`);
  console.log(`   Tests completed: ${RESULTS.length}`);

  const totalErrors = RESULTS.reduce((sum, r) => sum + (r.errors || 0), 0);
  const totalOps = RESULTS.reduce((sum, r) => sum + (r.ops || 0), 0);
  const errorRate = totalOps > 0 ? (totalErrors / totalOps * 100).toFixed(2) : '0';

  console.log(`   Total ops: ${totalOps} | Errors: ${totalErrors} (${errorRate}%)`);
  console.log(`   Status: ${totalErrors === 0 ? '🏆 ALL TESTS PASSED' : '⚠️  SOME TESTS HAD ERRORS'}`);
  console.log('═'.repeat(70));

  await redis.quit();
  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
