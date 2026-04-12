/**
 * Redis Cache Integration Test
 *
 * Tests the Redis cache layer with a real Redis instance.
 * Falls back to in-memory mock if Redis is unavailable.
 *
 * Usage:
 *   # With running Redis:
 *   docker run -d --name redis-test -p 6379:6379 redis:7-alpine
 *   node scripts/test-redis-cache.js
 *
 *   # Without Redis (fallback mode):
 *   node scripts/test-redis-cache.js
 */

// ============================================================
// In-Memory Redis Mock (for testing without Docker)
// ============================================================

class InMemoryCache {
  constructor() {
    this.store = new Map();
    console.log('[Cache] Using in-memory fallback (no Redis available)');
  }

  async get(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expireAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async setex(key, ttl, value) {
    this.store.set(key, {
      value,
      expireAt: Date.now() + ttl * 1000,
    });
    return 'OK';
  }

  async del(key) {
    this.store.delete(key);
    return 1;
  }

  async keys(pattern) {
    const regex = new RegExp('^' + pattern.replace('*', '.*') + '$');
    return [...this.store.keys()].filter(k => regex.test(k));
  }

  async scanStream(options = {}) {
    const pattern = options.match || '*';
    const regex = new RegExp('^' + pattern.replace('*', '.*') + '$');
    const keys = [...this.store.keys()].filter(k => regex.test(k));
    return {
      on: (event, cb) => {
        if (event === 'data') cb(keys.slice(0, options.count || 100));
        if (event === 'end') cb();
      }
    };
  }

  async info() {
    return `db0:keys=${this.store.size},expires=0,avg_ttl=0\nused_memory_human=0.00M`;
  }

  async quit() {
    this.store.clear();
    return 'OK';
  }
}

// ============================================================
// Test Runner
// ============================================================

async function testCache() {
  let cache;

  // Try real Redis first
  try {
    const Redis = require('ioredis');
    cache = new Redis('redis://localhost:6379', {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      lazyConnect: true,
    });
    await cache.connect();
    console.log('[Cache] Connected to Redis');
  } catch {
    cache = new InMemoryCache();
  }

  const results = [];

  // ============================================================
  // Test 1: Basic set/get
  // ============================================================
  console.log('\n📝 Test 1: Basic SET/GET');
  const start1 = Date.now();
  await cache.setex('test:basic', 60, JSON.stringify({ hello: 'world' }));
  const raw = await cache.get('test:basic');
  const parsed = JSON.parse(raw);
  const lat1 = Date.now() - start1;
  const pass1 = parsed.hello === 'world';
  results.push({ test: 'Basic SET/GET', pass: pass1, latency: lat1 });
  console.log(`   Result: ${pass1 ? '✅ PASS' : '❌ FAIL'} (${lat1}ms)`);

  // ============================================================
  // Test 2: TTL expiration
  // ============================================================
  console.log('\n⏱️  Test 2: TTL Expiration (1s TTL)');
  await cache.setex('test:ttl', 1, JSON.stringify({ data: 'temp' }));
  const exists = await cache.get('test:ttl');
  const pass2a = exists !== null;
  results.push({ test: 'TTL: exists immediately', pass: pass2a, latency: 0 });
  console.log(`   Immediately: ${pass2a ? '✅ PASS' : '❌ FAIL'}`);

  // Wait for TTL to expire
  await new Promise(r => setTimeout(r, 1100));
  const expired = await cache.get('test:ttl');
  const pass2b = expired === null;
  results.push({ test: 'TTL: expired after 1s', pass: pass2b, latency: 1100 });
  console.log(`   After 1s: ${pass2b ? '✅ PASS (expired)' : '❌ FAIL (still exists)'}`);

  // ============================================================
  // Test 3: Pattern deletion
  // ============================================================
  console.log('\n🗑️  Test 3: Pattern Invalidation');
  await cache.setex('test:pattern:1', 60, 'value1');
  await cache.setex('test:pattern:2', 60, 'value2');
  await cache.setex('test:other', 60, 'other');

  // Delete pattern
  const keys = await cache.keys('test:pattern:*');
  if (keys.length > 0) {
    await cache.del(keys);
  }
  const remaining = await cache.keys('test:pattern:*');
  const pass3 = remaining.length === 0;
  results.push({ test: 'Pattern invalidation', pass: pass3, latency: 0 });
  console.log(`   Keys after delete: ${remaining.length} — ${pass3 ? '✅ PASS' : '❌ FAIL'}`);

  // ============================================================
  // Test 4: Performance — 1000 reads
  // ============================================================
  console.log('\n⚡ Test 4: Performance — 1000 reads');
  for (let i = 0; i < 100; i++) {
    await cache.setex(`test:perf:${i}`, 60, `value-${i}`);
  }

  const t0 = Date.now();
  let hits = 0;
  for (let i = 0; i < 1000; i++) {
    const idx = i % 100;
    const val = await cache.get(`test:perf:${idx}`);
    if (val !== null) hits++;
  }
  const totalLat = Date.now() - t0;
  const pass4 = hits === 1000;
  const avgLat = (totalLat / 1000).toFixed(2);
  results.push({ test: '1000 reads', pass: pass4, latency: totalLat, avg: avgLat });
  console.log(`   Hits: ${hits}/1000 — ${pass4 ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   Total: ${totalLat}ms, Avg: ${avgLat}ms`);

  // ============================================================
  // Test 5: Serialization
  // ============================================================
  console.log('\n📦 Test 5: Complex serialization');
  const complexData = {
    user: { id: '123', name: 'Test', roles: ['admin', 'operator'] },
    timestamp: Date.now(),
    nested: { a: { b: { c: [1, 2, 3, null, true, false] } } },
  };
  await cache.setex('test:complex', 60, JSON.stringify(complexData));
  const fetched = JSON.parse(await cache.get('test:complex'));
  const pass5 = fetched.user.id === '123' && fetched.nested.a.b.c[2] === 3;
  results.push({ test: 'Complex serialization', pass: pass5, latency: 0 });
  console.log(`   ${pass5 ? '✅ PASS' : '❌ FAIL'}`);

  // ============================================================
  // Summary
  // ============================================================
  console.log('\n' + '='.repeat(60));
  console.log('📊 Redis Cache Test Results');
  console.log('='.repeat(60));
  const passed = results.filter(r => r.pass).length;
  const total = results.length;
  console.log(`   Passed: ${passed}/${total}`);
  console.log(`   Failed: ${total - passed}/${total}`);
  console.log('');
  for (const r of results) {
    const icon = r.pass ? '✅' : '❌';
    const extra = r.avg ? ` (avg ${r.avg}ms)` : r.latency ? ` (${r.latency}ms)` : '';
    console.log(`   ${icon} ${r.test}${extra}`);
  }
  console.log('='.repeat(60));
  console.log(`   Overall: ${passed === total ? '🏆 ALL PASSED' : '⚠️  SOME FAILED'}`);
  console.log('='.repeat(60));

  // Cleanup
  await cache.quit();
  process.exit(passed === total ? 0 : 1);
}

testCache().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
