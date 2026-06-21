/**
 * WebSocket Server — Production-Grade
 *
 * Standalone server running on separate port.
 * Handles real-time event delivery to connected clients.
 *
 * Features:
 * - Session-based authentication (reuse existing auth)
 * - Channel-based subscriptions with ACL
 * - Heartbeat/keepalive for dead connection detection
 * - Redis Pub/Sub bridge for horizontal scaling
 * - Graceful shutdown
 *
 * Usage:
 *   npx tsx src/realtime/server/index.ts
 *
 * Or as a Docker container / systemd service.
 */

import http from 'http';
import { WebSocketServer } from 'ws';
import { ClientManager } from './client-manager';
import { canSubscribe, getDefaultChannels } from './channel-router';
import { authenticateWS } from './auth';
import { onChannel, CHANNEL_EVENTS } from '../redis/pubsub';
import { logger } from '@/lib/logger';
import { setWsConnectionCount, recordWorkerHeartbeat } from '@/core/observability/health-tracker';
import {
  MessageTracker,
  ReplayBufferManager,
  BackpressureController,
  DEFAULT_RELIABILITY_CONFIG,
} from '../reliability';

// ============================================================
// Configuration
// ============================================================

const PORT = Number(process.env.WS_PORT || 3001);
const HEARTBEAT_INTERVAL_MS = 30000; // 30s
const DEAD_CONNECTION_TIMEOUT_MS = 60000; // 60s

// Reliability layer
const messageTracker = new MessageTracker(DEFAULT_RELIABILITY_CONFIG);
const replayBuffer = new ReplayBufferManager(DEFAULT_RELIABILITY_CONFIG);
const backpressure = new BackpressureController(DEFAULT_RELIABILITY_CONFIG);

// ============================================================
// Server Setup
// ============================================================

export async function startWSServer(): Promise<ServerHandle> {
  const clients = new ClientManager();

  // Create HTTP server for upgrade
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'pilingtrack-realtime',
      clients: clients.size,
      uptime: process.uptime(),
    }));
  });

  const wss = new WebSocketServer({ server });

  // ============================================================
  // Connection Handler
  // ============================================================

  wss.on('connection', async (ws, req) => {
    // Authenticate
    const auth = await authenticateWS(req);

    if (!auth) {
      ws.send(JSON.stringify({
        type: 'error',
        code: 'AUTH_FAILED',
        message: 'Authentication required',
      }));
      ws.close(1008, 'Authentication failed');
      return;
    }

    // Register client
    const clientId = clients.addClient(ws, {
      userId: auth.userId,
      tenantId: auth.tenantId,
      role: auth.role,
    });

    // Initialize reliability buffers
    replayBuffer.createBuffer(clientId);
    backpressure.initClient(clientId);

    // Auto-subscribe to default channels
    const defaults = getDefaultChannels({
      userId: auth.userId,
      tenantId: auth.tenantId,
      role: auth.role,
      siteIds: auth.siteIds,
    });

    for (const ch of defaults) {
      clients.subscribe(ws, ch);
    }

    // Send welcome message with server metadata
    ws.send(JSON.stringify({
      type: 'welcome',
      clientId,
      channels: defaults,
      serverTs: Date.now(),
      protocol: 'pilingtrack-realtime-v1',
    }));

    // ============================================================
    // Message Handler
    // ============================================================

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as Record<string, unknown>;

        switch (msg.type) {
          case 'subscribe': {
            const channel = msg.channel as string;
            if (canSubscribe({
              userId: auth.userId,
              tenantId: auth.tenantId!,
              role: auth.role,
              siteIds: auth.siteIds,
            }, channel as any)) {
              clients.subscribe(ws, channel as any);
              ws.send(JSON.stringify({
                type: 'subscribed',
                channel,
              }));
            } else {
              ws.send(JSON.stringify({
                type: 'error',
                code: 'ACCESS_DENIED',
                message: `Cannot subscribe to ${channel}`,
              }));
            }
            break;
          }

          case 'unsubscribe':
            clients.unsubscribe(ws, (msg.channel as string) as any);
            break;

          case 'ping':
            clients.recordPong(ws);
            ws.send(JSON.stringify({ type: 'pong', serverTs: Date.now() }));
            break;

          case 'pong':
            clients.recordPong(ws);
            break;

          // ============================================================
          // Reliability Protocol
          // ============================================================

          case 'ack': {
            const messageId = msg.messageId as string;
            messageTracker.ack(messageId);
            if (clientId) {
              replayBuffer.ackMessage(clientId, messageId);
            }
            break;
          }

          case 'nack': {
            const messageId = msg.messageId as string;
            const reason = msg.reason as string;
            const trackedMsg = messageTracker.nack(messageId, reason);
            if (trackedMsg) {
              // Re-send the message
              clients.sendToClient(ws, JSON.stringify({
                type: 'event',
                id: trackedMsg.id,
                seq: trackedMsg.seq,
                event: trackedMsg.event,
              }));
            }
            break;
          }

          case 'replay': {
            const fromSeq = msg.fromSeq as number;
            if (clientId && fromSeq !== undefined) {
              const replayMessages = replayBuffer.getReplayMessages(clientId, fromSeq);

              for (const trackedMsg of replayMessages) {
                clients.sendToClient(ws, JSON.stringify({
                  type: 'event',
                  id: trackedMsg.id,
                  seq: trackedMsg.seq,
                  event: trackedMsg.event,
                  replay: true,
                }));
              }

              logger.info('Replayed messages to client', {
                clientId,
                fromSeq,
                replayedCount: replayMessages.length,
              });
            }
            break;
          }

          default:
            ws.send(JSON.stringify({
              type: 'error',
              code: 'UNKNOWN_MESSAGE',
              message: `Unknown message type: ${msg.type}`,
            }));
        }
      } catch (error) {
        logger.error('WS message parse error', error);
      }
    });

    // ============================================================
    // Close Handler
    // ============================================================

    ws.on('close', () => {
      if (clientId) {
        replayBuffer.removeBuffer(clientId);
        backpressure.removeClient(clientId);
      }
      clients.removeClient(ws);
    });

    ws.on('error', (err) => {
      logger.error('WS client error', err, { clientId });
      clients.removeClient(ws);
    });
  });

  // ============================================================
  // Redis Pub/Sub → WS Broadcast
  // ============================================================

  onChannel(CHANNEL_EVENTS, (_channel, message) => {
    try {
      const event = JSON.parse(message);

      // Determine target channels
      const channels: string[] = [];
      if (event.tenantId) channels.push(`tenant:${event.tenantId}`);
      if (event.siteId) channels.push(`site:${event.siteId}`);
      if (event.entity) channels.push(`${event.entity}:${event.entityId}`);
      if (event.userId) channels.push(`operator:${event.userId}`);

      if (channels.length === 0) return;

      // Track message for reliability
      const trackedMsg = messageTracker.createMessage(event);

      // Broadcast with sequence number
      const messageWithSeq = JSON.stringify({
        type: 'event',
        id: trackedMsg.id,
        seq: trackedMsg.seq,
        event,
      });

      const sent = clients.broadcast(messageWithSeq, channels);

      // Add to replay buffers for each client
      for (const client of (clients as any).clients?.values?.() || []) {
        if (client.subscriptions) {
          const hasSubscription = channels.some((ch: string) => {
            if (client.subscriptions.has(ch)) return true;
            for (const sub of client.subscriptions) {
              if (sub.endsWith(':*') && ch.startsWith(sub.replace(':*', ':'))) return true;
            }
            return false;
          });
          if (hasSubscription) {
            replayBuffer.addMessage(client.id, trackedMsg);
          }
        }
      }

      if (sent > 0) {
        logger.debug('Realtime event broadcast', {
          type: event.type,
          entityId: event.entityId,
          sentTo: sent,
          messageId: trackedMsg.id,
          seq: trackedMsg.seq,
        });
      }
    } catch (error) {
      logger.error('Failed to broadcast event from Redis', error);
    }
  });

  // ============================================================
  // Heartbeat
  // ============================================================

  const heartbeatTimer = setInterval(() => {
    clients.pingAll();
    const removed = clients.cleanupDeadConnections(DEAD_CONNECTION_TIMEOUT_MS);

    if (removed > 0) {
      logger.info('Cleaned up dead WS connections', { removed });
    }

    // Prune old acked messages from reliability layer
    messageTracker.pruneAckedMessages();

    // Report connection count to health tracker
    setWsConnectionCount(clients.size).catch(() => {});
    recordWorkerHeartbeat('websocket').catch(() => {});

    // Log reliability stats periodically
    const trackerStats = messageTracker.getStats();
    const bufferStats = replayBuffer.getStats();
    logger.debug('Reliability stats', {
      tracker: trackerStats,
      buffer: bufferStats,
    });
  }, HEARTBEAT_INTERVAL_MS);

  // ============================================================
  // Start Listening
  // ============================================================

  await new Promise<void>((resolve, reject) => {
    server.listen(PORT, () => {
      logger.info('WebSocket server started', { port: PORT });
      resolve();
    });
    server.on('error', reject);
  });

  // ============================================================
  // Graceful Shutdown
  // ============================================================

  const shutdown = async () => {
    logger.info('WebSocket server shutting down');
    clearInterval(heartbeatTimer);

    // Close all client connections
    clients.closeAll();

    // Close HTTP server
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });

    logger.info('WebSocket server stopped');
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return {
    shutdown,
    getStats: () => clients.getStats(),
  };
}

export interface ServerHandle {
  shutdown: () => Promise<void>;
  getStats: () => { totalClients: number; channels: number };
}
