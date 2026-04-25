/**
 * Sync Status UI Component
 *
 * Displays current sync status: pending | syncing | failed | synced
 * Shows queue counts, last sync time, and manual sync button.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { Wifi, WifiOff, Loader2, RefreshCw, AlertCircle, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getSyncStatusUI, runSyncCycle, retryFailedSync } from './sync-runner';
import type { SyncStatus } from '@/core/shared/types/sync';

interface SyncStatusData {
  isOnline: boolean;
  isSyncing: boolean;
  queue: { pending: number; syncing: number; failed: number };
  lastSyncAt: string | null;
}

export function SyncStatusBar() {
  const [status, setStatus] = useState<SyncStatusData | null>(null);
  const [manualSyncing, setManualSyncing] = useState(false);

  const refresh = useCallback(async () => {
    const data = await getSyncStatusUI();
    setStatus(data);
  }, []);

  useEffect(() => {
    refresh();

    // Online/offline detection
    const onOnline = () => refresh();
    const onOffline = () => refresh();

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [refresh]);

  if (!status) return null;

  const hasPending = status.queue.pending > 0;
  const hasFailed = status.queue.failed > 0;

  return (
    <div className="flex items-center gap-2 text-xs">
      {/* Connection status */}
      {status.isOnline ? (
        <Wifi className="w-3.5 h-3.5 text-green-500" />
      ) : (
        <WifiOff className="w-3.5 h-3.5 text-slate-400" />
      )}

      {/* Sync status indicator */}
      {status.isSyncing || manualSyncing ? (
        <div className="flex items-center gap-1 text-slate-500">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          <span>Синхронизация...</span>
        </div>
      ) : hasFailed ? (
        <div className="flex items-center gap-1 text-amber-600">
          <AlertCircle className="w-3.5 h-3.5" />
          <span>{status.queue.failed} ошибок</span>
          <button
            onClick={async () => {
              await retryFailedSync();
              refresh();
            }}
            className="ml-1 text-amber-700 hover:text-amber-800 underline"
          >
            Повтор
          </button>
        </div>
      ) : hasPending ? (
        <div className="flex items-center gap-1 text-blue-600">
          <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
          <span>{status.queue.pending} ожидают</span>
        </div>
      ) : (
        <div className="flex items-center gap-1 text-green-600">
          <CheckCircle className="w-3.5 h-3.5" />
          <span>Синхронизировано</span>
        </div>
      )}

      {/* Last sync time */}
      {status.lastSyncAt && (
        <span className="text-slate-400 tabular-nums">
          {formatRelativeTime(status.lastSyncAt)}
        </span>
      )}

      {/* Manual sync button */}
      <button
        onClick={async () => {
          setManualSyncing(true);
          try {
            await runSyncCycle();
          } finally {
            setManualSyncing(false);
            refresh();
          }
        }}
        disabled={manualSyncing || !status.isOnline}
        className={cn(
          'w-6 h-6 rounded flex items-center justify-center transition-colors',
          'hover:bg-slate-100 text-slate-400 hover:text-slate-600',
          'disabled:opacity-30 disabled:cursor-not-allowed'
        )}
        title="Синхронизировать сейчас"
      >
        <RefreshCw className={cn('w-3.5 h-3.5', manualSyncing && 'animate-spin')} />
      </button>
    </div>
  );
}

// ============================================================
// Helpers
// ============================================================

function formatRelativeTime(isoString: string): string {
  const then = new Date(isoString).getTime();
  const now = Date.now();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);

  if (diffSec < 10) return 'только что';
  if (diffSec < 60) return `${diffSec}с назад`;
  if (diffMin < 60) return `${diffMin}м назад`;

  return new Date(isoString).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });
}
