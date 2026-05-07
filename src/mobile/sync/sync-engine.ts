/**
 * Sync Engine v3 — Push Outbox + Pull Updates with Vector Clocks
 *
 * STATUS: Disabled (no-op). The push/pull functions return early without
 * hitting the network. Re-enable by deleting the early `return` lines in
 * pushOutbox() and pullUpdates() — and at the same time decide what to do
 * about /api/sync/v2 requiring `reports.manage_all`, which makes operators
 * get 403/429 in a tight loop.
 *
 * Why disabled: in production the sync loop fired against an unauthenticated
 * service-worker context (no session cookie) and produced 401/429 storms in
 * the logs. A previous prod-only patch silenced this by checking
 * localStorage.getItem('accessToken'), but tokens are not kept there in this
 * codebase, so the patch effectively short-circuited every call. Rather than
 * keep that subtle behaviour as drift between repo and prod, we make the
 * disabled state explicit here.
 *
 * What still works without sync v3: online CRUD via /api/reports/upsert,
 * /api/reports/delete, etc. Only the offline outbox + vector-clock pull is
 * paused.
 *
 * Coordinates:
 * 1. Push: send pending outbox items to backend (with vector clocks)
 * 2. Pull: fetch server updates since last sync (with vector clocks)
 * 3. Conflict resolution: vector clock causal ordering + field merge
 *
 * Triggers:
 * - Network restored (online event)
 * - App resume
 * - Manual sync button
 * - Timer (every 90s when online and visible)
 */

import { outboxService } from '../outbox/outbox-service';
import { getDB } from '../db/schema';
import {
  attachVCToOutboxEntry,
  applyServerVCToReport,
} from './vector-clock-manager';
import type { LocalReport, OutboxEntry } from '../db/schema';
import type { VectorClockData } from '@/core/shared/sync/vector-clock';

// ============================================================
// Configuration
// ============================================================

const SYNC_CONFIG = {
  batchSize: 20,
  maxRetries: 5,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  pullIntervalMs: 90000, // 90s when online
  autoSyncDelayMs: 2000, // Delay after network restored
};

// ============================================================
// Push: Send Outbox to Server
// ============================================================

async function pushOutbox(): Promise<{ pushed: number; failed: number }> {
  // sync v3 disabled — see file header.
  return { pushed: 0, failed: 0 };
}

export function serializeOutboxItem(item: OutboxEntry) {
  const payload = item.payload as Record<string, unknown> & { vectorClock?: VectorClockData };

  return {
    id: `op_${item.id}_${item.createdAt}`,
    type: item.type,
    entity: item.entity,
    entityId: item.entityId,
    payload: item.payload,
    vectorClock: payload.vectorClock, // include causal ordering
    localTimestamp: item.createdAt,
  };
}

// ============================================================
// Pull: Fetch Server Updates
// ============================================================

async function pullUpdates(): Promise<{ received: number }> {
  // sync v3 disabled — see file header.
  return { received: 0 };
}

async function applyServerReports(reports: any[]): Promise<number> {
  const db = getDB();
  let count = 0;

  for (const serverReport of reports) {
    const localReport = await db.reports.get(serverReport.reportId);

    // Conflict resolution: last-write-wins
    // If local is pending/modified, keep local (will sync later)
    if (localReport && localReport.syncStatus === 'pending') {
      continue; // Local changes take priority
    }

    // Apply server vector clock if present
    if (serverReport.vectorClock && localReport) {
      try {
        await applyServerVCToReport(serverReport.reportId, serverReport.vectorClock);
      } catch {
        // Non-critical — continue without VC merge
      }
    }

    // Upsert from server
    await db.reports.put({
      id: serverReport.reportId,
      tenantId: serverReport.tenantId || null,
      siteId: serverReport.siteId,
      siteName: serverReport.site?.name || '',
      userId: serverReport.userId,
      userName: serverReport.user?.name || '',
      date: serverReport.date,
      shiftType: serverReport.shiftType,
      shiftStart: serverReport.shiftStart || null,
      shiftEnd: serverReport.shiftEnd || null,
      equipmentId: serverReport.equipmentId || null,
      status: serverReport.status,
      syncStatus: 'synced',
      serverVersion: serverReport.version,
      vectorClock: serverReport.vectorClock || localReport?.vectorClock,
      localVersion: (localReport?.localVersion || 0) + 1,
      createdAt: serverReport.createdAt,
      updatedAt: serverReport.updatedAt,
      lastSyncedAt: new Date().toISOString(),
    });

    // Upsert child entries
    if (serverReport.piles?.length > 0) {
      await db.pileWork.bulkPut(
        serverReport.piles.map((p: any) => ({
          id: p.id,
          reportId: serverReport.reportId,
          picketId: p.picketId || null,
          pileGradeId: p.pileGradeId,
          pileGradeName: p.pileGrade?.name || '',
          count: p.count,
          updatedAt: serverReport.updatedAt,
        }))
      );
    }

    if (serverReport.drillings?.length > 0) {
      await db.drillings.bulkPut(
        serverReport.drillings.map((d: any) => ({
          id: d.id,
          reportId: serverReport.reportId,
          picketId: d.picketId || null,
          typeId: d.typeId,
          typeName: d.type?.name || '',
          count: d.count,
          metersPerUnit: d.metersPerUnit,
          meters: d.meters,
          updatedAt: serverReport.updatedAt,
        }))
      );
    }

    if (serverReport.downtimes?.length > 0) {
      await db.downtimes.bulkPut(
        serverReport.downtimes.map((dt: any) => ({
          id: dt.id,
          reportId: serverReport.reportId,
          reasonId: dt.reasonId,
          reasonName: dt.reason?.name || '',
          duration: dt.duration,
          comment: dt.comment || null,
          updatedAt: serverReport.updatedAt,
        }))
      );
    }

    count++;
  }

  return count;
}

async function applyServerEvents(_events: any[]): Promise<void> {
  // Process server-side events (alerts, notifications, etc.)
  // For now, log them — can be extended for push notifications
}

// ============================================================
// Retry Delay — Exponential Backoff
// ============================================================

export function calculateRetryDelay(attempt: number): number {
  const delay = SYNC_CONFIG.baseDelayMs * Math.pow(2, attempt);
  const jitter = delay * 0.25 * Math.random();
  return Math.min(delay + jitter, SYNC_CONFIG.maxDelayMs);
}

// ============================================================
// Full Sync Cycle
// ============================================================

export async function runSyncCycle(): Promise<{
  pushed: number;
  pulled: number;
  failed: number;
}> {
  // Lock to prevent concurrent syncs
  if (syncInProgress) {
    return { pushed: 0, pulled: 0, failed: 0 };
  }

  syncInProgress = true;

  try {
    // 1. Push local changes first
    const pushResult = await pushOutbox();

    // 2. Pull server updates
    const pullResult = await pullUpdates();

    return {
      pushed: pushResult.pushed,
      pulled: pullResult.received,
      failed: pushResult.failed,
    };
  } finally {
    syncInProgress = false;
  }
}

let syncInProgress = false;

// ============================================================
// Auto-Sync Triggers
// ============================================================

let syncTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start automatic sync when online.
 */
export function startAutoSync() {
  // Network restored → sync after delay
  window.addEventListener('online', () => {
    console.log('[Sync] Network restored, scheduling sync...');
    setTimeout(() => runSyncCycle(), SYNC_CONFIG.autoSyncDelayMs);
  });

  // App resume → sync
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && navigator.onLine) {
      console.log('[Sync] App resumed, syncing...');
      runSyncCycle();
    }
  });

  // Periodic pull sync
  syncTimer = setInterval(() => {
    if (document.visibilityState === 'visible' && navigator.onLine && !syncInProgress) {
      runSyncCycle();
    }
  }, SYNC_CONFIG.pullIntervalMs);

  console.log('[Sync] Auto-sync started');
}

/**
 * Stop automatic sync.
 */
export function stopAutoSync() {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
}

/**
 * Manual sync (user button).
 */
export async function manualSync(): Promise<{
  pushed: number;
  pulled: number;
  failed: number;
}> {
  return runSyncCycle();
}

/**
 * Get current sync status for UI.
 */
export async function getSyncStatusUI(): Promise<{
  isOnline: boolean;
  isSyncing: boolean;
  pending: number;
  failed: number;
}> {
  const stats = await outboxService.getSyncStatus();

  return {
    isOnline: navigator.onLine,
    isSyncing: syncInProgress,
    pending: stats.pending,
    failed: stats.failed,
  };
}
