/**
 * Client Manager — WebSocket Connection Management
 *
 * Tracks all connected clients, their subscriptions, and handles
 * heartbeat/keepalive to detect dead connections.
 */

import WebSocket from 'ws';
import { ChannelType } from '../types/events';
import { logger } from '@/lib/logger';

// ============================================================
// Client Interface
// ============================================================

export interface WSClient {
  id: string;
  ws: WebSocket;
  userId: string | null;
  tenantId: string | null;
  role: string | null;
  subscriptions: Set<ChannelType>;
  connectedAt: number;
  lastPingAt: number;
}

// ============================================================
// Client Manager
// ============================================================

export class ClientManager {
  private clients = new Map<string, WSClient>();
  private wsToId = new Map<WebSocket, string>();

  /**
   * Add a new client connection.
   */
  addClient(ws: WebSocket, context: {
    userId: string | null;
    tenantId: string | null;
    role: string | null;
  }): string {
    const id = crypto.randomUUID();

    const client: WSClient = {
      id,
      ws,
      userId: context.userId,
      tenantId: context.tenantId,
      role: context.role,
      subscriptions: new Set(),
      connectedAt: Date.now(),
      lastPingAt: Date.now(),
    };

    // Auto-subscribe to tenant channel
    if (context.tenantId) {
      client.subscriptions.add(`tenant:${context.tenantId}`);
    }

    this.clients.set(id, client);
    this.wsToId.set(ws, id);

    logger.info('WS client connected', {
      clientId: id,
      userId: context.userId,
      tenantId: context.tenantId,
      role: context.role,
      totalClients: this.clients.size,
    });

    return id;
  }

  /**
   * Remove a client connection.
   */
  removeClient(ws: WebSocket): void {
    const id = this.wsToId.get(ws);
    if (!id) return;

    const client = this.clients.get(id);
    if (client) {
      logger.info('WS client disconnected', {
        clientId: id,
        userId: client.userId,
        uptime: Date.now() - client.connectedAt,
        totalClients: this.clients.size - 1,
      });
    }

    this.clients.delete(id);
    this.wsToId.delete(ws);
  }

  /**
   * Get client by WebSocket instance.
   */
  getClient(ws: WebSocket): WSClient | undefined {
    const id = this.wsToId.get(ws);
    if (!id) return undefined;
    return this.clients.get(id);
  }

  /**
   * Subscribe client to a channel.
   */
  subscribe(ws: WebSocket, channel: ChannelType): boolean {
    const client = this.getClient(ws);
    if (!client) return false;

    client.subscriptions.add(channel);
    logger.debug('Client subscribed to channel', {
      clientId: client.id,
      channel,
      totalSubscriptions: client.subscriptions.size,
    });

    return true;
  }

  /**
   * Unsubscribe client from a channel.
   */
  unsubscribe(ws: WebSocket, channel: ChannelType): boolean {
    const client = this.getClient(ws);
    if (!client) return false;

    client.subscriptions.delete(channel);
    return true;
  }

  /**
   * Send data to a specific client.
   */
  sendToClient(ws: WebSocket, data: string): boolean {
    if (ws.readyState !== WebSocket.OPEN) return false;

    try {
      ws.send(data);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Broadcast to all clients subscribed to channels.
   * Returns count of successfully sent messages.
   */
  broadcast(data: string, channels: string[]): number {
    let sent = 0;

    for (const client of this.clients.values()) {
      if (client.ws.readyState !== WebSocket.OPEN) continue;

      // Check if client is subscribed to any of the channels
      const hasSubscription = channels.some(ch => {
        // Exact match
        if (client.subscriptions.has(ch as ChannelType)) return true;

        // Wildcard: site:* matches site:abc
        for (const sub of client.subscriptions) {
          if (sub.endsWith(':*') && ch.startsWith(sub.replace(':*', ':'))) return true;
        }

        return false;
      });

      if (hasSubscription) {
        try {
          client.ws.send(data);
          sent++;
        } catch {
          // Client may have disconnected — will be cleaned up on next heartbeat
        }
      }
    }

    return sent;
  }

  /**
   * Update last ping time for a client.
   */
  recordPong(ws: WebSocket): void {
    const client = this.getClient(ws);
    if (client) {
      client.lastPingAt = Date.now();
    }
  }

  /**
   * Remove dead connections (no pong response within timeout).
   */
  cleanupDeadConnections(timeoutMs = 60000): number {
    const now = Date.now();
    let removed = 0;

    for (const [id, client] of this.clients) {
      if (now - client.lastPingAt > timeoutMs) {
        logger.warn('Removing dead WS client', {
          clientId: id,
          lastPing: client.lastPingAt,
          idleMs: now - client.lastPingAt,
        });

        try {
          client.ws.terminate();
        } catch {
          // Already closed
        }

        this.clients.delete(id);
        this.wsToId.delete(client.ws);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Send ping to all clients.
   */
  pingAll(): void {
    const now = Date.now();
    const pingData = JSON.stringify({ type: 'ping', serverTs: now });

    for (const client of this.clients.values()) {
      if (client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(pingData);
        } catch {
          // Will be cleaned up next cycle
        }
      }
    }
  }

  /**
   * Get connected client count.
   */
  get size(): number {
    return this.clients.size;
  }

  /**
   * Get stats.
   */
  getStats() {
    return {
      totalClients: this.clients.size,
      channels: new Set(
        Array.from(this.clients.values()).flatMap(c => Array.from(c.subscriptions))
      ).size,
    };
  }

  /**
   * Close all connections (graceful shutdown).
   */
  closeAll(): void {
    for (const client of this.clients.values()) {
      client.ws.close(1001, 'Server shutting down');
    }
    this.clients.clear();
    this.wsToId.clear();
  }
}
