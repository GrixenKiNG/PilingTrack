/**
 * MQTT Telemetry Ingestion Service
 *
 * Connects to an MQTT broker and ingests telemetry messages
 * into the TelemetryRecord model.
 *
 * Features:
 * - Topic-based routing: pilingtrack/telemetry/{equipmentId}
 * - QoS 1 for reliable delivery
 * - Automatic reconnection
 * - Message validation via Zod
 *
 * Usage:
 *   const mqtt = await startMqttIngestion();
 *   mqtt.stop(); // graceful shutdown
 */

import { z } from 'zod';
import { db } from '@/lib/db';
import { ingestTelemetry } from '@/services/telemetry/telemetry-ingestion-service';
import { logger } from '@/lib/logger';

// ============================================================
// Message Schema
// ============================================================

const telemetryMessageSchema = z.object({
  type: z.string().max(50),
  value: z.number(),
  unit: z.string().optional().nullable(),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
  timestamp: z.string().datetime().optional(),
});

// ============================================================
// MQTT Configuration
// ============================================================

interface MqttConfig {
  brokerUrl: string;
  clientId: string;
  username?: string;
  password?: string;
  qos: 0 | 1 | 2;
  topicPrefix: string;
}

function getConfig(): MqttConfig | null {
  const brokerUrl = process.env.MQTT_BROKER_URL;
  if (!brokerUrl) return null;

  return {
    brokerUrl,
    clientId: process.env.MQTT_CLIENT_ID || `pilingtrack-${Date.now()}`,
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD,
    qos: (parseInt(process.env.MQTT_QOS || '1') as 0 | 1 | 2) || 1,
    topicPrefix: process.env.MQTT_TOPIC_PREFIX || 'pilingtrack/telemetry',
  };
}

// ============================================================
// Message Handler
// ============================================================

async function handleTelemetryMessage(topic: string, payload: Buffer): Promise<void> {
  // Extract equipmentId from topic: pilingtrack/telemetry/{equipmentId}
  const parts = topic.split('/');
  const equipmentId = parts[parts.length - 1];

  if (!equipmentId) {
    logger.warn('MQTT: no equipmentId in topic', { topic });
    return;
  }

  let json: unknown;
  try {
    json = JSON.parse(payload.toString());
  } catch {
    logger.warn('MQTT: invalid JSON payload', { topic });
    return;
  }

  const validated = telemetryMessageSchema.safeParse(json);
  if (!validated.success) {
    logger.warn('MQTT: invalid message schema', { issues: validated.error.flatten() });
    return;
  }

  const message = validated.data;

  try {
    await ingestTelemetry({
      type: message.type as any,
      equipmentId,
      siteId: (message.metadata?.siteId as string) ?? undefined,
      value: message.value,
      unit: message.unit ?? undefined,
      latitude: message.latitude ?? undefined,
      longitude: message.longitude ?? undefined,
      metadata: (message.metadata as Record<string, unknown>) ?? undefined,
      timestamp: message.timestamp ? new Date(message.timestamp) : undefined,
    });
  } catch (error) {
    logger.error('MQTT: failed to ingest telemetry', error);
  }
}

// ============================================================
// MQTT Client Lifecycle
// ============================================================

let mqttClient: unknown = null;

export async function startMqttIngestion(): Promise<{ stop: () => Promise<void> }> {
  const config = getConfig();
  if (!config) {
    logger.info('MQTT: no MQTT_BROKER_URL configured, skipping ingestion');
    return { stop: async () => {} };
  }

  // Dynamic import to avoid requiring mqtt package when not used
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  let mqtt: any;
  try {
    // @ts-expect-error mqtt is optional — install with: npm install mqtt
    mqtt = await import('mqtt');
  } catch {
    logger.error('MQTT: mqtt package not installed. Run: npm install mqtt');
    return { stop: async () => {} };
  }

  const client = mqtt.connect(config.brokerUrl, {
    clientId: config.clientId,
    username: config.username,
    password: config.password,
    clean: true,
    reconnectPeriod: 5000,
    connectTimeout: 10000,
  });

  client.on('connect', () => {
    logger.info('MQTT: connected to broker', { brokerUrl: config.brokerUrl });
    
    // Subscribe to telemetry topic with wildcard
    const topic = `${config.topicPrefix}/#`;
    client.subscribe(topic, { qos: config.qos }, (err: Error | null) => {
      if (err) {
        logger.error('MQTT: failed to subscribe', err);
      } else {
        logger.info('MQTT: subscribed', { topic });
      }
    });
  });

  client.on('message', handleTelemetryMessage);

  client.on('error', (error: Error) => {
    logger.error('MQTT: client error', error);
  });

  client.on('reconnect', () => {
    logger.info('MQTT: reconnecting');
  });

  client.on('close', () => {
    logger.info('MQTT: connection closed');
  });

  mqttClient = client;

  return {
    stop: async () => {
      logger.info('MQTT: stopping ingestion');
      await new Promise<void>((resolve) => {
        client.end(() => resolve());
      });
      mqttClient = null;
    },
  };
}

export async function stopMqttIngestion(): Promise<void> {
  if (!mqttClient) return;
  
  const client = mqttClient as any;
  await new Promise<void>((resolve) => {
    client.end(() => resolve());
  });
  mqttClient = null;
}
