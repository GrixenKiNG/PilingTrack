/**
 * Sync Queue — Dexie-based offline queue for local changes
 *
 * Architecture:
 * - Reports stored locally in Dexie (offline-first)
 * - Changes tracked in 'syncQueue' table with opId, baseVersion
 * - Sync runner pushes changes → server → applies server changes
 * - Conflict resolution on client side (field-merge)
 *
 * Usage:
 *   const queue = getSyncQueue();
 *   await queue.enqueueChange({ entity: 'report', op: 'upsert', data: ..., baseVersion: 1 });
 *   await queue.commit();
 *
 *   const result = await runSync();
 *   if (result.conflicts.length > 0) showConflictUI(result.conflicts);
 */

import Dexie, { type Table } from 'dexie';
import { v4 as uuid } from 'uuid';
import type {
  EntityType,
  OperationType,
  SyncResponse,
  Conflict,
  SyncStatus,
} from '@/shared/types/sync';

// ============================================================
// Dexie Schema
// ============================================================

interface ReportRow {
  id: string;
  tenantId: string;
  userId: string;
  siteId: string;
  date: string;
  status: string;
  version: number;
  deviceId: string;
  updatedAt: string;
  createdAt: string;
  // Denormalized data
  shiftType: string;
  shiftStart: string | null;
  shiftEnd: string | null;
  equipmentId: string | null;
  piles: { pileGradeId: string; count: number }[];
  drillings: { typeId: string; meters: number }[];
  downtimes: { reasonId: string; duration: number; comment: string | null }[];
}

export interface SyncQueueEntry {
  id?: number;            // auto-increment
  opId: string;           // UUID for idempotency
  entity: EntityType;
  op: OperationType;
  data: unknown;
  baseVersion: number;
  status: 'pending' | 'syncing' | 'synced' | 'failed';
  error?: string;
  attempts: number;
  createdAt: string;
}

interface SyncStateRow {
  key: string;            // 'lastSyncAt' | 'deviceId' | 'userId'
  value: string;
}

class SyncDatabase extends Dexie {
  reports!: Table<ReportRow, string>;
  syncQueue!: Table<SyncQueueEntry, number>;
  syncState!: Table<SyncStateRow, string>;

  constructor() {
    super('pilingtrack-sync');

    this.version(1).stores({
      reports: 'id, updatedAt, date',
      syncQueue: '++, opId, entity, status',
      syncState: 'key',
    });
  }
}

// Singleton
let dbInstance: SyncDatabase | null = null;

export function getSyncDB(): SyncDatabase {
  if (!dbInstance) {
    dbInstance = new SyncDatabase();
  }
  return dbInstance;
}

// ============================================================
// Sync Queue Operations
// ============================================================

export interface QueuedChange {
  opId: string;
  entity: EntityType;
  op: OperationType;
  data: unknown;
  baseVersion: number;
}

export class SyncQueue {
  private db: SyncDatabase;

  constructor(db: SyncDatabase) {
    this.db = db;
  }

  /**
   * Enqueue a local change.
   */
  async enqueue(change: Omit<QueuedChange, 'opId'>): Promise<string> {
    const opId = uuid();

    await this.db.syncQueue.add({
      opId,
      ...change,
      status: 'pending',
      attempts: 0,
      createdAt: new Date().toISOString(),
    });

    return opId;
  }

  /**
   * Get pending changes (up to limit).
   */
  async getPending(limit: number = 100): Promise<SyncQueueEntry[]> {
    return this.db.syncQueue
      .where('status')
      .equals('pending')
      .limit(limit)
      .toArray();
  }

  /**
   * Mark entries as syncing.
   */
  async markSyncing(opIds: string[]): Promise<void> {
    await Promise.all(
      opIds.map(opId =>
        this.db.syncQueue.where('opId').equals(opId).modify({ status: 'syncing' })
      )
    );
  }

  /**
   * Mark entries as synced.
   */
  async markSynced(opIds: string[]): Promise<void> {
    await this.db.syncQueue.where('opId').anyOf(opIds).delete();
  }

  /**
   * Mark entries as failed.
   */
  async markFailed(opIds: string[], error: string): Promise<void> {
    await Promise.all(
      opIds.map(opId =>
        this.db.syncQueue
          .where('opId')
          .equals(opId)
          .modify((entry) => {
            entry.status = 'failed';
            entry.error = error;
            entry.attempts = (entry.attempts ?? 0) + 1;
          })
      )
    );
  }

  /**
   * Retry failed entries (up to maxAttempts).
   */
  async retryFailed(maxAttempts: number = 5): Promise<number> {
    const failed = await this.db.syncQueue
      .where('status')
      .equals('failed')
      .filter(entry => entry.attempts < maxAttempts)
      .toArray();

    if (failed.length > 0) {
      await Promise.all(
        failed.map(entry =>
          this.db.syncQueue.update(entry.id!, {
            status: 'pending',
            error: undefined,
          })
        )
      );
    }

    return failed.length;
  }

  /**
   * Get queue stats.
   */
  async getStats(): Promise<{
    pending: number;
    syncing: number;
    failed: number;
    synced: number;
  }> {
    const entries = await this.db.syncQueue.toArray();
    return {
      pending: entries.filter(e => e.status === 'pending').length,
      syncing: entries.filter(e => e.status === 'syncing').length,
      failed: entries.filter(e => e.status === 'failed').length,
      synced: entries.filter(e => e.status === 'synced').length,
    };
  }

  /**
   * Clear all synced entries.
   */
  async clearSynced(): Promise<void> {
    await this.db.syncQueue.where('status').equals('synced').delete();
  }
}

// ============================================================
// Sync State (persistent key-value)
// ============================================================

export class SyncStateStore {
  private db: SyncDatabase;

  constructor(db: SyncDatabase) {
    this.db = db;
  }

  async get(key: string): Promise<string | null> {
    const entry = await this.db.syncState.get(key);
    return entry?.value || null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.db.syncState.put({ key, value });
  }

  async getDeviceId(): Promise<string> {
    let deviceId = await this.get('deviceId');
    if (!deviceId) {
      deviceId = `device-${uuid().slice(0, 8)}`;
      await this.set('deviceId', deviceId);
    }
    return deviceId;
  }

  async getLastSyncAt(): Promise<string> {
    return await this.get('lastSyncAt') || '1970-01-01T00:00:00Z';
  }

  async setLastSyncAt(value: string): Promise<void> {
    await this.set('lastSyncAt', value);
  }
}

// ============================================================
// Convenience Exports
// ============================================================

export function getSyncQueue(): SyncQueue {
  return new SyncQueue(getSyncDB());
}

export function getSyncState(): SyncStateStore {
  return new SyncStateStore(getSyncDB());
}
