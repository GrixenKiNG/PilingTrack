/**
 * Mobile/Offline-First Module
 *
 * Central export for all offline-first functionality.
 *
 * Usage:
 *   import { initOffline, outboxService, SyncStatus } from '@/mobile';
 */

// Database
export { getDB, PilingDB } from './db/schema';
export type {
  LocalReport,
  LocalPileWork,
  LocalDrilling,
  LocalDowntime,
  OutboxEntry,
  SyncMeta,
  DictionaryEntry,
} from './db/schema';

// Outbox Service
export { outboxService, OutboxService } from './outbox/outbox-service';

// Sync Engine
export {
  runSyncCycle,
  startAutoSync,
  stopAutoSync,
  manualSync,
  getSyncStatusUI,
} from './sync/sync-engine';

// Network Monitor
export { networkMonitor, NetworkMonitor } from './network/network-monitor';

// UI Adapters
export { SyncStatus } from './ui-adapters/sync-status';

// Realtime
export { useRealtime, WSClient, handleRealtimeEvent, backfill } from './realtime';
export type { WSConnectionState, UseRealtimeOptions, UseRealtimeResult } from './realtime';

import { outboxService } from './outbox/outbox-service';
import { startAutoSync } from './sync/sync-engine';
import { networkMonitor } from './network/network-monitor';

// ============================================================
// Initialization
// ============================================================

/**
 * Initialize offline-first system.
 * Call once on app startup (in layout.tsx or similar).
 */
export function initOffline() {
  if (typeof window === 'undefined') return;

  // Start network monitoring
  networkMonitor.start();

  // Start auto-sync
  startAutoSync();

  // Periodic cleanup (every 24h)
  setInterval(() => {
    outboxService.clearOldSynced(7);
    outboxService.cleanupOldData(14);
  }, 24 * 60 * 60 * 1000);

  // eslint-disable-next-line no-console
  console.log('[PilingTrack] Offline-first initialized');
}
