/**
 * WebSocket Client — Connection Manager
 *
 * Handles WebSocket lifecycle: connect, reconnect, heartbeat, graceful close.
 *
 * Features:
 * - Exponential backoff reconnect (1s → 2s → 5s → 10s → 30s cap)
 * - Heartbeat (ping/pong)
 * - Connection state tracking
 * - Event callbacks
 */

import { WSClientMessage, WSServerMessage, RealtimeEvent } from '@/core/realtime/types/events';
import { logger } from '@/lib/logger';

// ============================================================
// Configuration
// ============================================================

const RECONNECT_BASE_DELAY = 1000;
const RECONNECT_MAX_DELAY = 30000;
const HEARTBEAT_INTERVAL = 30000;
const PONG_TIMEOUT = 10000;

// ============================================================
// State
// ============================================================

export type WSConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export type WSEventCallback = (event: RealtimeEvent) => void;
export type WSStateCallback = (state: WSConnectionState) => void;

// ============================================================
// WS Client Class
// ============================================================

export class WSClient {
  private ws: WebSocket | null = null;
  private state: WSConnectionState = 'disconnected';
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimeout: ReturnType<typeof setTimeout> | null = null;
  private expectingPong = false;

  // Callbacks
  private onEventCallbacks: WSEventCallback[] = [];
  private onStateCallbacks: WSStateCallback[] = [];

  constructor(
    private readonly url: string,
    private readonly getToken: () => string | null
  ) {}

  // ============================================================
  // Connection Management
  // ============================================================

  /**
   * Start connecting. Auto-reconnect on failure.
   */
  connect(): void {
    if (this.state === 'connecting' || this.state === 'connected') return;

    this.doConnect();
  }

  private doConnect(): void {
    this.setState(this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting');

    try {
      const token = this.getToken();
      const wsUrl = token ? `${this.url}?token=${encodeURIComponent(token)}` : this.url;

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.setState('connected');
        this.startHeartbeat();
        logger.info('WS connected');
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      this.ws.onclose = (event) => {
        this.stopHeartbeat();
        this.ws = null;
        logger.info('WS disconnected', { code: event.code, reason: event.reason });
        this.scheduleReconnect();
      };

      this.ws.onerror = (error) => {
        logger.error('WS error', error);
      };
    } catch (error) {
      logger.error('WS connection failed', error);
      this.scheduleReconnect();
    }
  }

  /**
   * Disconnect and stop reconnecting.
   */
  disconnect(): void {
    this.stopHeartbeat();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }

    this.setState('disconnected');
    this.reconnectAttempts = 0;
  }

  // ============================================================
  // Subscriptions
  // ============================================================

  /**
   * Subscribe to a channel.
   */
  subscribe(channel: string): void {
    this.send({ type: 'subscribe', channel: channel as any });
  }

  /**
   * Unsubscribe from a channel.
   */
  unsubscribe(channel: string): void {
    this.send({ type: 'unsubscribe', channel: channel as any });
  }

  // ============================================================
  // Callbacks
  // ============================================================

  onEvent(callback: WSEventCallback): () => void {
    this.onEventCallbacks.push(callback);
    return () => {
      this.onEventCallbacks = this.onEventCallbacks.filter(cb => cb !== callback);
    };
  }

  onStateChange(callback: WSStateCallback): () => void {
    this.onStateCallbacks.push(callback);
    return () => {
      this.onStateCallbacks = this.onStateCallbacks.filter(cb => cb !== callback);
    };
  }

  // ============================================================
  // Getters
  // ============================================================

  getState(): WSConnectionState {
    return this.state;
  }

  isConnected(): boolean {
    return this.state === 'connected';
  }

  // ============================================================
  // Internal
  // ============================================================

  private setState(state: WSConnectionState): void {
    this.state = state;
    for (const cb of this.onStateCallbacks) {
      cb(state);
    }
  }

  private scheduleReconnect(): void {
    if (this.state === 'disconnected') return; // Intentionally disconnected

    const delay = Math.min(
      RECONNECT_BASE_DELAY * Math.pow(2, this.reconnectAttempts),
      RECONNECT_MAX_DELAY
    );

    // Add jitter (±25%)
    const jitter = delay * 0.25 * Math.random();
    const finalDelay = delay + jitter;

    this.reconnectAttempts++;

    logger.info('WS reconnect scheduled', {
      attempt: this.reconnectAttempts,
      delayMs: Math.round(finalDelay),
    });

    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.doConnect(), finalDelay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      if (this.expectingPong) {
        // No pong received — connection is dead
        logger.warn('WS pong timeout, reconnecting');
        this.ws?.close();
        return;
      }

      this.expectingPong = true;
      this.send({ type: 'ping' });

      this.pongTimeout = setTimeout(() => {
        if (this.expectingPong) {
          logger.warn('WS pong timeout');
          this.ws?.close();
        }
      }, PONG_TIMEOUT);
    }, HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
    this.expectingPong = false;
  }

  private send(msg: WSClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private handleMessage(raw: string): void {
    try {
      const msg = JSON.parse(raw) as WSServerMessage | { type: string };

      switch (msg.type) {
        case 'pong':
          this.expectingPong = false;
          if (this.pongTimeout) {
            clearTimeout(this.pongTimeout);
            this.pongTimeout = null;
          }
          break;

        case 'ping':
          this.send({ type: 'pong' });
          break;

        case 'welcome':
        case 'subscribed':
          // Info messages — ignore for now
          break;

        case 'error':
          logger.error('WS server error', undefined, {
            code: (msg as any).code,
            message: (msg as any).message,
          });
          break;

        default:
          // Treat as realtime event
          if (msg.type && 'entity' in msg && 'payload' in msg) {
            const event = msg as RealtimeEvent;
            for (const cb of this.onEventCallbacks) {
              cb(event);
            }
          }
      }
    } catch (error) {
      logger.error('Failed to parse WS message', error, { raw });
    }
  }
}
