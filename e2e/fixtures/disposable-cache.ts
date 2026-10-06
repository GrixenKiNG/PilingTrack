import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { cache, closeRedisConnection } from '../../src/lib/redis-cache';

async function main() {
  const url = new URL(process.env.REDIS_URL_CACHE || 'http://invalid');
  assert.equal(url.hostname, '127.0.0.1');
  const prefix = 'codex-cache-' + randomUUID();
  try {
    assert.equal(await cache.set(prefix + ':a:one', { value: 1 }), true);
    assert.equal(await cache.set(prefix + ':b:one', { value: 2 }), true);
    assert.equal(await cache.invalidatePattern(prefix + ':a:*'), 1);
    assert.equal(await cache.get(prefix + ':a:one'), null);
    assert.deepEqual(await cache.get(prefix + ':b:one'), { value: 2 });
    console.log('Real cache Redis: prefixed SCAN/DEL invalidates only requested namespace');
  } finally { await cache.del(prefix + ':a:one'); await cache.del(prefix + ':b:one'); await closeRedisConnection(); }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
