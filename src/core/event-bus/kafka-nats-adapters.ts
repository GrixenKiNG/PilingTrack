/**
 * Event Bus — Kafka/NATS Adapter Interface
 *
 * Principal Engineer design:
 * - Abstract interface for any event transport
 * - Current: InMemory + Redis (already implemented)
 * - New: KafkaAdapter + NATSAdapter (ready for migration)
 * - Key features: durability, replay, partitioning, consumer groups
 *
 * Migration path:
 * 1. Use this interface with InMemory/Redis (current state)
 * 2. When throughput > 1000 events/sec, switch to KafkaAdapter
 * 3. Zero code change in consumers — only factory config changes
 *
 * Usage:
 *   // Current (Redis):
 *   const bus = createEventBus({ transport: 'redis', redisUrl: '...' });
 *
 *   // Future (Kafka):
 *   const bus = createEventBus({ transport: 'kafka', kafkaBrokers: ['kafka:9092'] });
 */

import { logger } from '@/lib/logger';
import type { DomainEvent } from '@/services/reports/domain-events';

// ============================================================
// Transport Interface
// ============================================================

export type TransportType = 'in-memory' | 'redis' | 'kafka' | 'nats';

export type EventHandler = (event: DomainEvent) => void | Promise<void>;

export interface EventBusTransport {
  /** Publish an event to the bus */
  publish(event: DomainEvent): Promise<void>;

  /** Publish many events atomically (where supported) */
  publishMany(events: DomainEvent[]): Promise<void>;

  /** Subscribe to an event type */
  subscribe(eventType: string, handler: EventHandler): void;

  /** Unsubscribe from an event type */
  unsubscribe(eventType: string, handler: EventHandler): void;

  /** Get transport-level stats (synchronous) */
  getStats(): EventBusStats;

  /** Graceful shutdown */
  close(): Promise<void>;

  /** Check if transport is healthy */
  isHealthy(): Promise<boolean>;
}

export interface EventBusStats {
  type: TransportType;
  handlersCount: Map<string, number>;
  totalPublished: number;
  totalErrors: number;
  // Kafka/NATS specific
  consumerGroup?: string;
  partitionCount?: number;
  lag?: number;
}

export interface EventBusConfig {
  transport: TransportType;
  redisUrl?: string;
  kafkaBrokers?: string[];
  kafkaConsumerGroup?: string;
  natsUrl?: string;
  natsQueueGroup?: string;
}

// ============================================================
// Kafka Adapter
// ============================================================

export class KafkaEventBus implements EventBusTransport {
  private handlers = new Map<string, Set<EventHandler>>();
  private totalPublished = 0;
  private totalErrors = 0;
  private producer: any = null;
  private consumer: any = null;
  private initialized = false;

  constructor(
    private readonly brokers: string[],
    private readonly consumerGroup: string = 'pilingtrack-event-consumers'
  ) {}

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    try {
      // Dynamic import — kafkajs is optional
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const kafkaModuleName = 'kafkajs';
      const { Kafka } = await import(kafkaModuleName);

      const kafka = new Kafka({
        brokers: this.brokers,
        clientId: 'pilingtrack',
      });

      this.producer = kafka.producer();
      await this.producer.connect();

      this.consumer = kafka.consumer({
        groupId: this.consumerGroup,
      });
      await this.consumer.connect();

      // Subscribe to all registered event types
      for (const eventType of this.handlers.keys()) {
        await this.consumer.subscribe({ topic: eventType, fromBeginning: false });
      }

      this.consumer.run({
        eachMessage: async ({ topic: msgTopic, message }: { topic: string; message: any }) => {
          const event = JSON.parse(message.value!.toString()) as DomainEvent;
          const eventHandlers = this.handlers.get(msgTopic);
          if (eventHandlers) {
            const results = await Promise.allSettled(
              Array.from(eventHandlers).map((h) => h(event))
            );

            for (let i = 0; i < results.length; i++) {
              if (results[i].status === 'rejected') {
                this.totalErrors++;
                const reason = (results[i] as PromiseRejectedResult).reason;
                logger.error(`Kafka handler [${i}] failed for ${msgTopic}`, {
                  error: reason instanceof Error ? reason.message : String(reason),
                });
              }
            }
          }
        },
      });

      this.initialized = true;
      logger.info('KafkaEventBus initialized', { brokers: this.brokers });
    } catch (error) {
      logger.error('Failed to initialize KafkaEventBus', error);
      throw error;
    }
  }

  async publish(event: DomainEvent): Promise<void> {
    await this.ensureInitialized();

    try {
      await this.producer.send({
        topic: event.type,
        messages: [
          {
            key: event.aggregateId,
            value: JSON.stringify(event),
            headers: {
              eventType: event.type,
              aggregateId: event.aggregateId,
              version: String(event.version ?? 1),
            },
          },
        ],
      });
      this.totalPublished++;
    } catch (error) {
      this.totalErrors++;
      logger.error('Failed to publish to Kafka', error, { type: event.type });
      throw error;
    }
  }

  async publishMany(events: DomainEvent[]): Promise<void> {
    await this.ensureInitialized();

    try {
      // Group by event type for efficient batch publishing
      const byType = new Map<string, DomainEvent[]>();
      for (const event of events) {
        if (!byType.has(event.type)) {
          byType.set(event.type, []);
        }
        byType.get(event.type)!.push(event);
      }

      for (const [type, typeEvents] of byType) {
        await this.producer.send({
          topic: type,
          messages: typeEvents.map((e) => ({
            key: e.aggregateId,
            value: JSON.stringify(e),
            headers: {
              eventType: e.type,
              aggregateId: e.aggregateId,
              version: String(e.version ?? 1),
            },
          })),
        });
      }

      this.totalPublished += events.length;
    } catch (error) {
      this.totalErrors++;
      logger.error('Failed to publish batch to Kafka', error);
      throw error;
    }
  }

  subscribe(eventType: string, handler: EventHandler): void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler);

    // If already initialized, subscribe consumer
    if (this.initialized && this.consumer) {
      this.consumer.subscribe({ topic: eventType, fromBeginning: false })
        .catch((err: Error) => logger.error('Failed to subscribe Kafka topic', err, { topic: eventType }));
    }
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
      type: 'kafka',
      handlersCount: handlerCounts,
      totalPublished: this.totalPublished,
      totalErrors: this.totalErrors,
      consumerGroup: this.consumerGroup,
    };
  }

  async close(): Promise<void> {
    try {
      if (this.consumer) await this.consumer.disconnect();
      if (this.producer) await this.producer.disconnect();
      logger.info('KafkaEventBus closed');
    } catch (error) {
      logger.error('Error closing KafkaEventBus', error);
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.ensureInitialized();
      return this.producer !== null;
    } catch {
      return false;
    }
  }
}

// ============================================================
// NATS Adapter
// ============================================================

export class NATSEventBus implements EventBusTransport {
  private handlers = new Map<string, Set<EventHandler>>();
  private totalPublished = 0;
  private totalErrors = 0;
  private connection: any = null;
  private subscription: any = null;
  private initialized = false;

  constructor(
    private readonly url: string,
    private readonly queueGroup: string = 'pilingtrack'
  ) {}

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    try {
      // Dynamic import — nats is optional
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const natsModuleName = 'nats';
      const { connect } = await import(natsModuleName);

      this.connection = await connect({ servers: this.url });
      this.initialized = true;

      // Subscribe to all registered event types
      for (const eventType of this.handlers.keys()) {
        this.subscribeNATS(eventType);
      }

      logger.info('NATSEventBus initialized', { url: this.url });
    } catch (error) {
      logger.error('Failed to initialize NATSEventBus', error);
      throw error;
    }
  }

  private subscribeNATS(eventType: string): void {
    if (!this.connection) return;

    const sub = this.connection.subscribe(eventType, {
      queue: this.queueGroup,
    });

    (async () => {
      for await (const msg of sub) {
        const data = JSON.parse(new TextDecoder().decode(msg.data)) as DomainEvent;
        const handlers = this.handlers.get(eventType);
        if (handlers) {
          const results = await Promise.allSettled(
            Array.from(handlers).map((h) => h(data))
          );

          for (let i = 0; i < results.length; i++) {
            if (results[i].status === 'rejected') {
              this.totalErrors++;
              const reason = (results[i] as PromiseRejectedResult).reason;
              logger.error(`NATS handler [${i}] failed for ${eventType}`, {
                error: reason instanceof Error ? reason.message : String(reason),
              });
            }
          }
        }
      }
    })();
  }

  async publish(event: DomainEvent): Promise<void> {
    await this.ensureInitialized();

    try {
      this.connection.publish(
        event.type,
        new TextEncoder().encode(JSON.stringify(event))
      );
      this.totalPublished++;
    } catch (error) {
      this.totalErrors++;
      logger.error('Failed to publish to NATS', error, { type: event.type });
      throw error;
    }
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

    if (this.initialized) {
      this.subscribeNATS(eventType);
    }
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
      type: 'nats',
      handlersCount: handlerCounts,
      totalPublished: this.totalPublished,
      totalErrors: this.totalErrors,
      consumerGroup: this.queueGroup,
    };
  }

  async close(): Promise<void> {
    try {
      if (this.connection) await this.connection.close();
      logger.info('NATSEventBus closed');
    } catch (error) {
      logger.error('Error closing NATSEventBus', error);
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.ensureInitialized();
      return this.connection !== null && !this.connection.isClosed();
    } catch {
      return false;
    }
  }
}

// ============================================================
// Factory — Auto-select transport
// ============================================================

import { createEventBus as createLegacyEventBus } from '@/core/event-bus/event-bus';

export function createEventBusV2(config: EventBusConfig) {
  switch (config.transport) {
    case 'kafka':
      if (!config.kafkaBrokers?.length) {
        throw new Error('Kafka transport requires kafkaBrokers');
      }
      return new KafkaEventBus(config.kafkaBrokers, config.kafkaConsumerGroup);

    case 'nats':
      if (!config.natsUrl) {
        throw new Error('NATS transport requires natsUrl');
      }
      return new NATSEventBus(config.natsUrl, config.natsQueueGroup);

    case 'redis':
      // Delegate to existing Redis implementation
      return createLegacyEventBus({ redisUrl: config.redisUrl });

    case 'in-memory':
    default:
      // Delegate to existing in-memory implementation
      return createLegacyEventBus();
  }
}
