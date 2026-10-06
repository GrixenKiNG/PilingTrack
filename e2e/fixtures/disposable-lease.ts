import { strict as assert } from 'node:assert';
import { randomUUID } from 'node:crypto';
import { LeaderElection } from '../../src/core/infrastructure/leader-election';
import { getStateRedisClient, closeRedisConnection } from '../../src/lib/redis-cache';

async function main() {
  const url = new URL(process.env.REDIS_URL || 'http://invalid');
  assert.equal(url.hostname, '127.0.0.1');
  const a = new LeaderElection('codex-e0b-' + randomUUID(), { ttl: 2000, renewInterval: 200 });
  const b = new LeaderElection(a.getStats().resource.slice('leader:'.length), { ttl: 2000, renewInterval: 200 });
  try {
    assert.notEqual(a.getStats().nodeId, b.getStats().nodeId);
    await a.start(); await b.start();
    assert.equal(a.isLeader(), true); assert.equal(b.isLeader(), false);
    const redis = await getStateRedisClient(); assert.ok(redis);
    assert.equal(await redis.get(a.getStats().resource), a.getStats().nodeId);
    await b.stop();
    assert.equal(await redis.get(a.getStats().resource), a.getStats().nodeId);
    await a.stop(); await b.start();
    assert.equal(b.isLeader(), true);
    assert.equal(await redis.get(b.getStats().resource), b.getStats().nodeId);
    console.log('Real Redis: distinct owners, follower cannot release leader, takeover passed');
  } finally { await a.stop(); await b.stop(); await closeRedisConnection(); }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
