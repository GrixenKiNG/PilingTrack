/**
 * Redis Pub/Sub Bridge
 *
 * Connects WebSocket server to Redis for horizontal scaling.
 * Multiple WS instances communicate through Redis channels.
 *
 * Usage:
 *   import { pub, sub, CHANNEL_EVENTS } from '@/realtime/redis/pubsub';
 *   await pub.publish(CHANNEL_EVENTS, JSON.stringify(event));
 */

import Redis from 'ioredis';
import { logger } from '@/lib/logger';

export const CHANNEL_EVENTS = 'realtime:events';
export const CHANNEL_ALERTS = 'realtime:alerts';

// Publisher connection
let _pub: Redis | null = null;

export function getPublisher(): Redis {
  if (!_pub) {
    const url = process.env.REDIS_URL || 'redis://localhost:6379';
    _pub = new Redis(url, {
      lazyConnect: false,
      retryStrategy: (times) => Math.min(times * 100, 3000),
    });

    _pub.on('error', (err) => {
      logger.error('Redis publisher error', err);
    });

    _pub.on('connect', () => {
      logger.info('Redis publisher connected');
    });
  }

  return _pub;
}

// Subscriber connection (separate connection required)
let _sub: Redis | null = null;
const subHandlers = new Map<string, (channel: string, message: string) => void>();

export function getSubscriber(): Redis {
  if (!_sub) {
    const url = process.env.REDIS_URL || 'redis://localhost:6379';
    _sub = new Redis(url, {
      lazyConnect: false,
      retryStrategy: (times) => Math.min(times * 100, 3000),
    });

    _sub.on('message', (channel, message) => {
      const handler = subHandlers.get(channel);
      if (handler) {
        handler(channel, message);
      }
    });

    _sub.on('error', (err) => {
      logger.error('Redis subscriber error', err);
    });

    _sub.on('connect', () => {
      logger.info('Redis subscriber connected');
    });
  }

  return _sub;
}

/**
 * Register a handler for a Redis channel.
 */
export function onChannel(channel: string, handler: (ch: string, msg: string) => void): void {
  subHandlers.set(channel, handler);

  const sub = getSubscriber();
  // ioredis handles duplicate subscribe calls
  sub.subscribe(channel).catch((err) => {
    logger.error('Failed to subscribe to channel', err, { channel });
  });
}

/**
 * Publish event to Redis channel.
 */
export async function publishToRedis(
  channel: string,
  data: Record<string, unknown>
): Promise<void> {
  try {
    const pub = getPublisher();
    await pub.publish(channel, JSON.stringify(data));
  } catch (error) {
    logger.error('Failed to publish to Redis', error, { channel });
  }
}

/**
 * Close connections (graceful shutdown).
 */
export async function closeRedis(): Promise<void> {
  if (_pub) {
    await _pub.quit();
    _pub = null;
  }
  if (_sub) {
    await _sub.quit();
    _sub = null;
  }
}
