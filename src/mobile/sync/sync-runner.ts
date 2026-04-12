/**
 * Sync Runner — Orchestrates client-server synchronization
 *
 * Flow:
 * 1. Collect pending changes from queue
 * 2. Mark them as syncing
 * 3. POST to /api/sync/v2
 * 4. Apply server changes to local DB
 * 5. Resolve conflicts (auto-merge or queue for manual)
 * 6. Mark sent changes as synced
 * 7. Update lastSyncAt
 *
 * Retry strategy:
 * - Exponential backoff: 1s → 2s → 4s → 8s → 16s (max 5 attempts)
 * - Partial success: only delete synced entries, keep failed for retry
 * - Network detection: skip if offline
 */

import type {
  SyncResponse,
  Conflict,
  ServerChange,
  SyncStatus,
} from '@/shared/types/sync';
import { resolveConflict } from '@/shared/sync/conflict-resolver';
import { getSyncQueue, getSyncState, getSyncDB, type SyncQueueEntry } from './sync-queue';

// ============================================================
// Configuration
// ============================================================

const SYNC_CONFIG = {
  batchSize: 100,
  maxRetries: 5,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  autoSyncIntervalMs: 60000, // 60 seconds
};

// ============================================================
// Sync Runner
// ============================================================

export interface SyncResult {
  status: SyncStatus;
  applied: number;
  conflicts: Conflict[];
  skipped: number;
  error?: string;
}

let syncInProgress = false;

/**
 * Run a full sync cycle.
 */
export async function runSyncCycle(): Promise<SyncResult> {
  if (syncInProgress) {
    return { status: 'idle', applied: 0, conflicts: [], skipped: 0 };
  }

  if (!navigator.onLine) {
    return { status: 'idle', applied: 0, conflicts: [], skipped: 0, error: 'offline' };
  }

  syncInProgress = true;

  try {
    const queue = getSyncQueue();
    const state = getSyncState();

    // 1. Collect pending changes
    const pending = await queue.getPending(SYNC_CONFIG.batchSize);
    if (pending.length === 0) {
      // No local changes — just pull server updates
      return pullServerChanges();
    }

    // 2. Mark as syncing
    const opIds = pending.map(e => e.opId);
    await queue.markSyncing(opIds);

    // 3. Build sync request
    const deviceId = await state.getDeviceId();
    const lastSyncAt = await state.getLastSyncAt();

    const requestBody = {
      deviceId,
      tenantId: (await state.get('tenantId')) || 'default',
      userId: (await state.get('userId')) || '',
      lastSyncAt,
      changes: pending.map(entry => ({
        entity: entry.entity,
        op: entry.op,
        data: entry.data,
        baseVersion: entry.baseVersion,
        opId: entry.opId,
      })),
    };

    // 4. POST to server
    const response = await fetch('/api/sync/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      credentials: 'include',
    });

    if (!response.ok) {
      // Mark as failed for retry
      await queue.markFailed(opIds, `HTTP ${response.status}: ${response.statusText}`);
      return {
        status: 'failed',
        applied: 0,
        conflicts: [],
        skipped: 0,
        error: `Sync failed: ${response.status}`,
      };
    }

    const data: SyncResponse = await response.json();

    // 5. Apply server changes
    await applyServerChanges(data.serverChanges);

    // 6. Handle conflicts
    const resolvedConflicts = await handleConflicts(data.conflicts);

    // 7. Mark sent changes as synced
    await queue.markSynced(opIds);

    // 8. Update sync state
    await state.setLastSyncAt(data.newSyncAt);

    return {
      status: 'synced',
      applied: data.stats.applied,
      conflicts: resolvedConflicts,
      skipped: data.stats.skipped,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[SyncRunner] Sync cycle failed:', message);

    // Mark syncing entries as failed for retry
    try {
      const queue = getSyncQueue();
      const syncing = await queue.getStats();
      if (syncing.syncing > 0) {
        // Reset syncing → pending for retry
        const db = getSyncDB();
        await db.syncQueue.where('status').equals('syncing').modify({
          status: 'pending',
        });
      }
    } catch {
      // Ignore cleanup errors
    }

    return {
      status: 'failed',
      applied: 0,
      conflicts: [],
      skipped: 0,
      error: message,
    };
  } finally {
    syncInProgress = false;
  }
}

// ============================================================
// Pull Server Changes (no local changes)
// ============================================================

async function pullServerChanges(): Promise<SyncResult> {
  const state = getSyncState();
  const deviceId = await state.getDeviceId();
  const lastSyncAt = await state.getLastSyncAt();

  const response = await fetch('/api/sync/v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deviceId,
      tenantId: (await state.get('tenantId')) || 'default',
      userId: (await state.get('userId')) || '',
      lastSyncAt,
      changes: [],
    }),
    credentials: 'include',
  });

  if (!response.ok) {
    return {
      status: 'failed',
      applied: 0,
      conflicts: [],
      skipped: 0,
      error: `Pull failed: ${response.status}`,
    };
  }

  const data: SyncResponse = await response.json();
  await applyServerChanges(data.serverChanges);
  await state.setLastSyncAt(data.newSyncAt);

  return {
    status: data.syncStatus || 'synced',
    applied: data.stats.applied,
    conflicts: [],
    skipped: data.stats.skipped,
  };
}

// ============================================================
// Apply Server Changes to Local DB
// ============================================================

async function applyServerChanges(changes: ServerChange[]): Promise<void> {
  const db = getSyncDB();

  for (const change of changes) {
    if (change.entity !== 'report') continue;

    const data = change.data as Record<string, unknown>;

    if (change.op === 'delete') {
      await db.reports.delete(data.id as string).catch(() => {
        // Already deleted — ignore
      });
    } else {
      await db.reports.put(data as any);
    }
  }
}

// ============================================================
// Conflict Handling
// ============================================================

async function handleConflicts(conflicts: Conflict[]): Promise<Conflict[]> {
  const resolved: Conflict[] = [];

  for (const conflict of conflicts) {
    // Auto-resolve via field-merge
    const resolvedData = resolveConflict(
      conflict.clientData as Record<string, unknown>,
      conflict.serverData as Record<string, unknown>,
      'field_merge'
    );

    // Apply resolved data locally
    const db = getSyncDB();
    await db.reports.put(resolvedData as any);

    resolved.push({
      ...conflict,
      resolvedData,
    });
  }

  return resolved;
}

// ============================================================
// Retry with Exponential Backoff
// ============================================================

export async function retryFailedSync(): Promise<number> {
  const queue = getSyncQueue();
  return queue.retryFailed(SYNC_CONFIG.maxRetries);
}

function calculateBackoff(attempt: number): number {
  const delay = SYNC_CONFIG.baseDelayMs * Math.pow(2, attempt);
  const jitter = delay * 0.2 * Math.random();
  return Math.min(delay + jitter, SYNC_CONFIG.maxDelayMs);
}

// ============================================================
// Auto Sync
// ============================================================

let autoSyncTimer: ReturnType<typeof setInterval> | null = null;

export function startAutoSync(): void {
  stopAutoSync();

  // Initial sync
  runSyncCycle();

  // Network restored
  window.addEventListener('online', () => {
    setTimeout(() => runSyncCycle(), 2000);
  });

  // Periodic
  autoSyncTimer = setInterval(() => {
    if (navigator.onLine && !syncInProgress) {
      runSyncCycle();
    }
  }, SYNC_CONFIG.autoSyncIntervalMs);
}

export function stopAutoSync(): void {
  if (autoSyncTimer) {
    clearInterval(autoSyncTimer);
    autoSyncTimer = null;
  }
}

// ============================================================
// Sync Status for UI
// ============================================================

export async function getSyncStatusUI(): Promise<{
  isOnline: boolean;
  isSyncing: boolean;
  queue: { pending: number; syncing: number; failed: number };
  lastSyncAt: string | null;
}> {
  const queue = getSyncQueue();
  const state = getSyncState();
  const stats = await queue.getStats();
  const lastSyncAt = await state.getLastSyncAt();

  return {
    isOnline: navigator.onLine,
    isSyncing: syncInProgress,
    queue: stats,
    lastSyncAt: lastSyncAt === '1970-01-01T00:00:00Z' ? null : lastSyncAt,
  };
}
