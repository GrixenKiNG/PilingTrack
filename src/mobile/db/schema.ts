/**
 * PilingTrack IndexedDB Schema (Dexie)
 *
 * Local database for offline-first operation.
 * Stores scoped data: current site, last 14 days.
 *
 * Tables:
 * - reports: shift reports (local cache)
 * - pileWork: pile entries per report
 * - drillings: drilling entries per report
 * - downtimes: downtime entries per report
 * - dictionaries: reference data (pile grades, types, reasons)
 * - outbox: pending operations queue
 * - syncMeta: sync cursor, last sync time
 */

import Dexie, { type Table } from 'dexie';

// ============================================================
// Entity Types
// ============================================================

import type { VectorClockData } from '@/shared/sync/vector-clock';

export interface LocalReport {
  id: string;           // reportId (from server)
  tenantId: string | null;
  siteId: string;
  siteName: string;
  userId: string;
  userName: string;
  date: string;         // YYYY-MM-DD
  shiftType: 'DAY' | 'NIGHT';
  shiftStart: string | null;
  shiftEnd: string | null;
  equipmentId: string | null;
  status: 'draft' | 'submitted' | 'synced' | 'error';
  syncStatus: 'synced' | 'pending' | 'error';
  serverVersion?: number;
  localVersion: number;
  vectorClock?: VectorClockData; // causal ordering for sync v3
  createdAt: string;
  updatedAt: string;
  lastSyncedAt?: string;
  syncError?: string;
}

export interface LocalPileWork {
  id: string;
  reportId: string;
  picketId: string | null;
  pileGradeId: string;
  pileGradeName: string;
  count: number;
  updatedAt: string;
}

export interface LocalDrilling {
  id: string;
  reportId: string;
  picketId: string | null;
  typeId: string;
  typeName: string;
  count: number;
  metersPerUnit: number;
  meters: number;
  updatedAt: string;
}

export interface LocalDowntime {
  id: string;
  reportId: string;
  reasonId: string;
  reasonName: string;
  duration: number;
  comment: string | null;
  updatedAt: string;
}

export interface OutboxEntry {
  id?: number;
  type: 'REPORT_CREATE' | 'REPORT_UPDATE' | 'REPORT_DELETE';
  entity: 'report';
  entityId: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'syncing' | 'synced' | 'failed';
  attempts: number;
  lastError: string | null;
  createdAt: number;
  syncedAt?: number;
}

export interface SyncMeta {
  key: string;
  value: string | number | null;
  updatedAt: number;
}

export interface DictionaryEntry {
  id: string;
  type: 'pileGrade' | 'drillingType' | 'downtimeReason';
  name: string;
  isActive: boolean;
  syncedAt: number;
}

// ============================================================
// Dexie Database
// ============================================================

export class PilingDB extends Dexie {
  reports!: Table<LocalReport, string>;
  pileWork!: Table<LocalPileWork, string>;
  drillings!: Table<LocalDrilling, string>;
  downtimes!: Table<LocalDowntime, string>;
  outbox!: Table<OutboxEntry, number>;
  syncMeta!: Table<SyncMeta, string>;
  dictionaries!: Table<DictionaryEntry, string>;

  constructor() {
    super('PilingTrackDB');

    this.version(1).stores({
      reports: `
        id,
        tenantId,
        siteId,
        userId,
        date,
        status,
        syncStatus,
        updatedAt
      `,
      pileWork: `
        id,
        reportId,
        updatedAt
      `,
      drillings: `
        id,
        reportId,
        updatedAt
      `,
      downtimes: `
        id,
        reportId,
        updatedAt
      `,
      outbox: `
        ++id,
        type,
        entity,
        entityId,
        status,
        createdAt
      `,
      syncMeta: `key`,
      dictionaries: `
        id,
        type,
        isActive
      `,
    });
  }
}

// ============================================================
// Singleton
// ============================================================

let _db: PilingDB | null = null;

export function getDB(): PilingDB {
  if (!_db) {
    _db = new PilingDB();
  }
  return _db;
}
