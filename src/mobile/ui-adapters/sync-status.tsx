/**
 * Sync Status Indicator — Offline-First + Real-Time UI
 *
 * Shows real-time sync state combining offline status and WS connection:
 * - 🟢 Connected (WS + synced)
 * - 🔵 Syncing (WS connected, syncing)
 * - 🟡 Pending (X unsynced changes)
 * - 🔴 Error (X failed synces)
 * - ⚪ Offline (no connection)
 *
 * Usage:
 *   import { SyncStatus } from '@/mobile/ui-adapters/sync-status';
 *   <SyncStatus />
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getSyncStatusUI, manualSync } from '@/mobile/sync/sync-engine';
import { networkMonitor } from '@/mobile/network/network-monitor';
import { useRealtime, WSConnectionState } from '@/mobile/realtime';

export function SyncStatus() {
  const [status, setStatus] = useState({
    isOnline: navigator.onLine,
    isSyncing: false,
    pending: 0,
    failed: 0,
  });

  const [lastSyncMessage, setLastSyncMessage] = useState('');

  // Realtime WS state
  const { state: wsState, eventCount } = useRealtime({
    onStateChange: () => {
      // WS state change — could show subtle indicator
    },
  });

  // Refresh status periodically
  const refreshStatus = useCallback(async () => {
    const s = await getSyncStatusUI();
    setStatus(s);
  }, []);

  useEffect(() => {
    let active = true;

    const refreshStatusEffect = async () => {
      const nextStatus = await getSyncStatusUI();
      if (active) {
        setStatus(nextStatus);
      }
    };

    void refreshStatusEffect();

    // Poll every 5s
    const interval = setInterval(() => {
      void refreshStatusEffect();
    }, 5000);

    // React to network changes
    const unsubOnline = networkMonitor.onOnline(() => {
      void refreshStatusEffect();
    });
    const unsubOffline = networkMonitor.onOffline(() => {
      void refreshStatusEffect();
    });

    return () => {
      active = false;
      clearInterval(interval);
      unsubOnline();
      unsubOffline();
    };
  }, []);

  // Manual sync handler
  const handleManualSync = async () => {
    setLastSyncMessage('Синхронизация...');
    try {
      const result = await manualSync();
      setLastSyncMessage(
        `Синхронизировано: ${result.pushed} отправлено, ${result.pulled} получено`
      );
      setTimeout(() => setLastSyncMessage(''), 3000);
    } catch {
      setLastSyncMessage('Ошибка синхронизации');
      setTimeout(() => setLastSyncMessage(''), 3000);
    }
    await refreshStatus();
  };

  // Determine display state
  const displayState = getDisplayState(status, wsState);

  return (
    <div className="flex items-center gap-2">
      {/* Status Badge */}
      <motion.button
        onClick={!status.isOnline ? undefined : handleManualSync}
        className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
          !status.isOnline
            ? 'bg-gray-100 text-gray-500 cursor-not-allowed'
            : status.failed > 0
              ? 'bg-red-50 text-red-700 hover:bg-red-100 cursor-pointer'
              : status.pending > 0
                ? 'bg-amber-50 text-amber-700 hover:bg-amber-100 cursor-pointer'
                : wsState === 'connected'
                  ? 'bg-green-50 text-green-700 hover:bg-green-100 cursor-pointer'
                  : 'bg-blue-50 text-blue-700 hover:bg-blue-100 cursor-pointer'
        }`}
        whileTap={!status.isOnline ? {} : { scale: 0.95 }}
        title={getStatusTooltip(status, wsState)}
      >
        <span className="relative flex h-2 w-2">
          <AnimatePresence mode="wait">
            <motion.span
              key={displayState.color}
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              className={`absolute inline-flex h-full w-full rounded-full ${displayState.dotColor} ${
                status.isSyncing ? 'animate-ping' : ''
              }`}
            />
          </AnimatePresence>
          <span
            className={`relative inline-flex h-2 w-2 rounded-full ${displayState.dotColor}`}
          />
        </span>
        <span>{displayState.label}</span>
        {(status.pending > 0 || status.failed > 0) && (
          <span className="ml-0.5 text-[10px] opacity-75">
            ({status.pending + status.failed})
          </span>
        )}
        {eventCount > 0 && wsState === 'connected' && (
          <span className="ml-0.5 text-[10px] opacity-50" title="Realtime events received">
            ·{eventCount > 99 ? '99+' : eventCount}
          </span>
        )}
      </motion.button>

      {/* Last Sync Message */}
      <AnimatePresence>
        {lastSyncMessage && (
          <motion.span
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="text-xs text-muted-foreground"
          >
            {lastSyncMessage}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

function getDisplayState(
  status: { isOnline: boolean; isSyncing: boolean; pending: number; failed: number },
  wsState: WSConnectionState
) {
  if (!status.isOnline) {
    return {
      label: 'Офлайн',
      color: 'gray',
      dotColor: 'bg-gray-400',
    };
  }

  if (wsState === 'connected') {
    if (status.failed > 0) {
      return {
        label: 'Ошибка',
        color: 'red',
        dotColor: 'bg-red-400',
      };
    }

    if (status.pending > 0) {
      return {
        label: `Синк ${status.pending}`,
        color: 'amber',
        dotColor: 'bg-amber-400',
      };
    }

    return {
      label: 'Realtime',
      color: 'green',
      dotColor: 'bg-green-400',
    };
  }

  if (wsState === 'connecting' || wsState === 'reconnecting') {
    return {
      label: 'Подключение...',
      color: 'blue',
      dotColor: 'bg-blue-400',
    };
  }

  // WS disconnected but online — polling mode
  if (status.pending > 0) {
    return {
      label: `Ожидает ${status.pending}`,
      color: 'amber',
      dotColor: 'bg-amber-400',
    };
  }

  return {
    label: 'Polling',
    color: 'blue',
    dotColor: 'bg-blue-400',
  };
}

function getStatusTooltip(
  status: { isOnline: boolean; isSyncing: boolean; pending: number; failed: number },
  wsState: WSConnectionState
) {
  if (!status.isOnline) return 'Нет подключения к сети';
  if (wsState === 'connected') {
    if (status.pending > 0) return `Realtime подключено, ${status.pending} ожидают отправки`;
    return 'Realtime подключено, всё синхронизировано';
  }
  if (wsState === 'connecting' || wsState === 'reconnecting') return 'Подключение к серверу...';
  return 'Режим опроса (WebSocket недоступен)';
}
