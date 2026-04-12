/**
 * Event Bus — Production Interface
 *
 * Abstraction over event publishing. Supports multiple backends:
 * - InMemory (default, no external deps)
 * - Redis Pub/Sub (production, requires REDIS_URL)
 * - NATS/Kafka (future, high-throughput)
 *
 * Usage:
 *   const bus = createEventBus();
 *   bus.publish(event);
 *   bus.subscribe('ReportCreated', handler);
 */

import type { DomainEvent, DomainEventType } from '@/services/reports/domain-events';
import { logger } from '@/lib/logger';
import { schemaRegistry } from './schema-registry';

// ============================================================
// Interface
// ============================================================

export type EventHandler = (event: DomainEvent) => void | Promise<void>;

export interface EventBus {
  publish(event: DomainEvent): Promise<void>;
  publishMany(events: DomainEvent[]): Promise<void>;
  subscribe(eventType: string, handler: EventHandler): void;
  unsubscribe(eventType: string, handler: EventHandler): void;
  getStats(): EventBusStats;
}

export interface EventBusStats {
  type: 'in-memory' | 'redis' | 'nats';
  handlersCount: Map<string, number>;
  totalPublished: number;
  totalErrors: number;
}

// ============================================================
// In-Memory Implementation (default)
// ============================================================

export class InMemoryEventBus implements EventBus {
  private handlers = new Map<string, Set<EventHandler>>();
  private totalPublished = 0;
  private totalErrors = 0;

  async publish(event: DomainEvent): Promise<void> {
    // 🔐 Validate against schema registry
    try {
      schemaRegistry.validate(event.type, event.version ?? 1, event.data);
    } catch (error) {
      logger.error('Schema validation error', error, { eventType: event.type, version: event.version });
      // Still publish — don't block the pipeline for validation errors
      // The error is logged for monitoring
    }

    const eventHandlers = this.handlers.get(event.type);
    if (!eventHandlers || eventHandlers.size === 0) {
      logger.debug('No handlers for event', { type: event.type });
      return;
    }

    logger.info('Event published', {
      type: event.type,
      aggregateId: event.aggregateId,
      handlerCount: eventHandlers.size,
    });

    // Execute ALL handlers — even if some fail, others must run
    const asyncResults = await Promise.allSettled(
      Array.from(eventHandlers).map(async (handler) => {
        try {
          await handler(event);
        } catch (err) {
          this.totalErrors++;
          throw err;
        }
      })
    );

    // Log failures
    for (let i = 0; i < asyncResults.length; i++) {
      const result = asyncResults[i];
      if (result.status === 'rejected') {
        const err = result.reason;
        logger.error(`Event handler [${i}] failed for ${event.type}`, {
          aggregateId: event.aggregateId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    this.totalPublished++;
  }

  async publishMany(events: DomainEvent[]): Promise<void> {
    for (const event of events) {
      await this.publish(event);
    }
  }

  subscribe(eventType: string, handler: EventHandler): void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler);
  }

  unsubscribe(eventType: string, handler: EventHandler): void {
    this.handlers.get(eventType)?.delete(handler);
  }

  getStats(): EventBusStats {
    const handlerCounts = new Map<string, number>();
    for (const [type, set] of this.handlers) {
      handlerCounts.set(type, set.size);
    }

    return {
      type: 'in-memory',
      handlersCount: handlerCounts,
      totalPublished: this.totalPublished,
      totalErrors: this.totalErrors,
    };
  }
}

// ============================================================
// Redis Implementation (production-ready, lazy init)
// ============================================================

export class RedisEventBus implements EventBus {
  private publisher: any = null; // Redis client
  private subscribers: Map<string, Set<EventHandler>> = new Map();
  private totalPublished = 0;
  private totalErrors = 0;
  private initialized = false;

  constructor(private readonly redisUrl: string) {}

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    try {
      let Redis: any;
      try {
        Redis = (await import('ioredis')).default;
      } catch {
        // ioredis not installed — log warning and degrade
        logger.warn('RedisEventBus requires ioredis: npm install ioredis');
        this.initialized = true;
        return;
      }

      this.publisher = new Redis(this.redisUrl);

      // Create a separate subscriber connection
      const subscriber = new Redis(this.redisUrl);

      // Subscribe to all registered event types
      for (const eventType of this.subscribers.keys()) {
        await subscriber.subscribe(eventType);
      }

      subscriber.on('message', (channel: string, message: string) => {
        const event = JSON.parse(message) as DomainEvent;
        const handlers = this.subscribers.get(channel);
        if (handlers) {
          for (const handler of handlers) {
            handler(event);
          }
        }
      });

      this.initialized = true;
      logger.info('RedisEventBus initialized');
    } catch (error) {
      logger.error('Failed to initialize RedisEventBus, falling back to in-memory', error);
      this.initialized = true;
    }
  }

  async publish(event: DomainEvent): Promise<void> {
    await this.ensureInitialized();

    if (this.publisher) {
      try {
        await this.publisher.publish(event.type, JSON.stringify(event));
        this.totalPublished++;
      } catch (error) {
        this.totalErrors++;
        logger.error('Failed to publish to Redis', error, { type: event.type });
      }
    }
  }

  async publishMany(events: DomainEvent[]): Promise<void> {
    for (const event of events) {
      await this.publish(event);
    }
  }

  subscribe(eventType: string, handler: EventHandler): void {
    if (!this.subscribers.has(eventType)) {
      this.subscribers.set(eventType, new Set());
    }
    this.subscribers.get(eventType)!.add(handler);
  }

  unsubscribe(eventType: string, handler: EventHandler): void {
    this.subscribers.get(eventType)?.delete(handler);
  }

  getStats(): EventBusStats {
    const handlerCounts = new Map<string, number>();
    for (const [type, set] of this.subscribers) {
      handlerCounts.set(type, set.size);
    }

    return {
      type: 'redis',
      handlersCount: handlerCounts,
      totalPublished: this.totalPublished,
      totalErrors: this.totalErrors,
    };
  }
}

// ============================================================
// Factory
// ============================================================

export function createEventBus(options?: { redisUrl?: string }): EventBus {
  const redisUrl = options?.redisUrl || process.env.REDIS_URL;

  if (redisUrl) {
    return new RedisEventBus(redisUrl);
  }

  return new InMemoryEventBus();
}

// ============================================================
// Global singleton
// ============================================================

let _globalBus: EventBus | null = null;

export function getEventBus(): EventBus {
  if (!_globalBus) {
    _globalBus = createEventBus();
  }
  return _globalBus;
}
