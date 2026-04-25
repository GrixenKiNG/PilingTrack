/**
 * useRealtime — React Hook for WebSocket Connection
 *
 * Provides real-time event updates from the WS server.
 * Handles connect, reconnect, backfill automatically.
 * Falls back to HTTP polling after persistent WS failures.
 *
 * Usage:
 *   const { state, lastEvent, isPolling, reconnectAttempts } = useRealtime();
 *
 *   // Or with event handler:
 *   useRealtime({
 *     onEvent: (event) => handleEvent(event),
 *   });
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { WSClient, WSConnectionState } from './ws-client';
import { handleRealtimeEvent } from './event-handlers';
import { getReliableDispatcher } from './reliable-dispatcher';
import { RealtimeEvent } from '@/core/realtime/types/events';
import { logger } from '@/lib/logger';

// ============================================================
// Configuration
// ============================================================

const POLLING_FALLBACK_THRESHOLD = 10; // Reconnect attempts before switching to polling
const POLLING_INTERVAL_MS = 15000; // 15 seconds

function getWSUrl(): string {
  const host = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001';
  return `${host}/ws`;
}

function getSessionToken(): string | null {
  // Session is stored in httpOnly cookie — WS server reads it directly
  // For cross-origin, pass token via query param
  return null;
}

// ============================================================
// Singleton WS Client
// ============================================================

let _client: WSClient | null = null;

function getClient(): WSClient {
  if (!_client) {
    _client = new WSClient(getWSUrl(), getSessionToken);
  }
  return _client;
}

// ============================================================
// Hook
// ============================================================

export interface UseRealtimeOptions {
  onEvent?: (event: RealtimeEvent) => void;
  onStateChange?: (state: WSConnectionState) => void;
  enabled?: boolean;
}

export interface UseRealtimeResult {
  state: WSConnectionState;
  lastEvent: RealtimeEvent | null;
  eventCount: number;
  isPolling: boolean;            // True when falling back to HTTP polling
  reconnectAttempts: number;     // Current reconnect attempt count
  reconnect: () => void;
  disconnect: () => void;
  subscribe: (channel: string) => void;
  unsubscribe: (channel: string) => void;
}

export function useRealtime(options: UseRealtimeOptions = {}): UseRealtimeResult {
  const { onEvent, onStateChange, enabled = true } = options;

  const [state, setState] = useState<WSConnectionState>('disconnected');
  const [lastEvent, setLastEvent] = useState<RealtimeEvent | null>(null);
  const [eventCount, setEventCount] = useState(0);
  const [isPolling, setIsPolling] = useState(false);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const onStateRef = useRef(onStateChange);
  onStateRef.current = onStateChange;

  // Track reconnect attempts
  const reconnectAttemptsRef = useRef(0);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isPollingRef = useRef(false);
  const lastEventTsRef = useRef<number>(Date.now());

  function stopPolling() {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    if (isPollingRef.current) {
      isPollingRef.current = false;
      setIsPolling(false);
    }
  }

  async function startPolling(dispatcher: ReturnType<typeof getReliableDispatcher>) {
    if (pollingIntervalRef.current) return;

    isPollingRef.current = true;
    setIsPolling(true);

    pollingIntervalRef.current = setInterval(async () => {
      try {
        const response = await fetch('/api/sync/updates?since=' + lastEventTsRef.current);
        if (!response.ok) return;

        const data = await response.json();

        // Process reports as realtime events
        if (data.reports?.length > 0) {
          for (const report of data.reports) {
            const ts = new Date(report.updatedAt).getTime();
            await handleRealtimeEvent({
              id: `poll_${report.reportId}_${ts}`,
              type: report.status === 'submitted' ? 'report.submitted' : 'report.updated',
              entity: 'report' as const,
              entityId: report.reportId,
              payload: {
                reportId: report.reportId,
                totalPiles: (report.piles || []).reduce((s: number, p: any) => s + p.count, 0),
                totalDrilling: (report.drillings || []).reduce((s: number, d: any) => s + d.meters, 0),
                totalDowntime: (report.downtimes || []).reduce((s: number, d: any) => s + d.duration, 0),
                status: report.status,
                updatedAt: report.updatedAt,
              } as any,
              tenantId: report.tenantId,
              siteId: report.siteId,
              userId: report.userId,
              ts,
            } as any);
            setEventCount(c => c + 1);
            lastEventTsRef.current = ts;
          }
        }

        // Also process feedback events
        if (data.events?.length > 0) {
          for (const evt of data.events) {
            await dispatcher.onEvent(evt as RealtimeEvent);
            setEventCount(c => c + 1);
          }
        }
      } catch (err) {
        logger.debug('Polling fallback error', err instanceof Error ? { message: err.message } : undefined);
      }
    }, POLLING_INTERVAL_MS);
  }

  // Connect on mount
  useEffect(() => {
    if (!enabled) return;

    const client = getClient();
    const dispatcher = getReliableDispatcher();
    client.connect();

    const unsubEvent = client.onEvent(async (event) => {
      setLastEvent(event);
      setEventCount(c => c + 1);
      lastEventTsRef.current = Date.now();

      // Process with reliability guarantees (dedup + backpressure)
      await dispatcher.onEvent(event);

      // Call custom handler
      onEventRef.current?.(event);
    });

    const unsubState = client.onStateChange(async (s) => {
      setState(s);
      onStateRef.current?.(s);

      // Track reconnect attempts from WSClient
      if (s === 'reconnecting') {
        reconnectAttemptsRef.current++;
        setReconnectAttempts(reconnectAttemptsRef.current);

        // After threshold, switch to HTTP polling fallback
        if (reconnectAttemptsRef.current >= POLLING_FALLBACK_THRESHOLD && !isPollingRef.current) {
          logger.warn('WS persistentные ошибки — переключение на HTTP polling', {
            attempts: reconnectAttemptsRef.current,
          });
          void startPolling(dispatcher);
        }
      }

      // Backfill + reorder after reconnect
      if (s === 'connected') {
        // Reset reconnect counter on successful connection
        reconnectAttemptsRef.current = 0;
        setReconnectAttempts(0);

        // Stop polling if WS recovered
        if (isPollingRef.current) {
          stopPolling();
        }

        const received = await dispatcher.onReconnect();
        if (received > 0) {
          setEventCount(c => c + received);
        }
      }
    });

    return () => {
      unsubEvent();
      unsubState();
      stopPolling();
    };
  }, [enabled]);

  // Actions
  const reconnect = useCallback(() => {
    reconnectAttemptsRef.current = 0;
    setReconnectAttempts(0);
    stopPolling();
    const client = getClient();
    client.disconnect();
    client.connect();
  }, [stopPolling]);

  const disconnect = useCallback(() => {
    stopPolling();
    getClient().disconnect();
  }, [stopPolling]);

  const subscribe = useCallback((channel: string) => {
    getClient().subscribe(channel);
  }, []);

  const unsubscribe = useCallback((channel: string) => {
    getClient().unsubscribe(channel);
  }, []);

  return {
    state,
    lastEvent,
    eventCount,
    isPolling,
    reconnectAttempts,
    reconnect,
    disconnect,
    subscribe,
    unsubscribe,
  };
}
