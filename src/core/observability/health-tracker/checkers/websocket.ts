import { getRedisClient } from '@/lib/redis-cache';
import { logger } from '../../logger';
import type { WebSocketHealth } from '../types';

export async function checkWebSocket(): Promise<WebSocketHealth> {
  try {
    const client = await getRedisClient();
    if (!client) {
      return { status: 'down' };
    }

    const connCount = await client.get('system:ws:connections');
    // The WS server refreshes this key with a 60s TTL. A missing key means
    // the heartbeat stopped — the server is down or can't reach Redis. The
    // old code mapped that to `up, connections: 0`, which kept deep health
    // green through a dead WS server (audit H3).
    if (connCount == null) {
      return { status: 'down' };
    }

    return {
      status: 'up',
      connections: parseInt(connCount, 10) || 0,
    };
  } catch {
    return { status: 'down' };
  }
}

/**
 * Update WebSocket connection count.
 * WS server should call this periodically.
 */
export async function setWsConnectionCount(count: number): Promise<void> {
  try {
    const client = await getRedisClient();
    if (!client) return;

    await client.set('system:ws:connections', String(count), 'EX', 60);
  } catch (err) {
    logger.warn('Failed to set WS connection count', { error: err });
  }
}
