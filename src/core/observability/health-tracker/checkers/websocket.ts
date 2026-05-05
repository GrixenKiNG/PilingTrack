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
    const connections = connCount ? parseInt(connCount, 10) : 0;

    return {
      status: 'up',
      connections,
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
