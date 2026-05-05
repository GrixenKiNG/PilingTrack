import { getRedisClient } from '@/lib/redis-cache';
import { withTimeout } from '../helpers';
import { REDIS_CHECK_TIMEOUT_MS, REDIS_SLOW_THRESHOLD_MS } from '../thresholds';
import type { RedisHealth } from '../types';

export async function checkRedis(): Promise<RedisHealth> {
  const start = Date.now();
  try {
    const client = await getRedisClient();
    if (!client) {
      return { status: 'down' };
    }

    await withTimeout(client.ping(), REDIS_CHECK_TIMEOUT_MS, 'Redis');
    const latency = Date.now() - start;

    return {
      status: latency > REDIS_SLOW_THRESHOLD_MS ? 'slow' : 'up',
      latencyMs: latency,
    };
  } catch {
    return {
      status: 'down',
      latencyMs: Date.now() - start,
    };
  }
}
