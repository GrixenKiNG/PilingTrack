/**
 * Sync Engine — Contract Types
 *
 * Общие типы для клиента и сервера. Определяют контракт синхронизации.
 *
 * Инварианты:
 * - version монотонно возрастает (только сервер инкрементирует)
 * - opId уникален для каждой операции (идемпотентность)
 * - baseVersion — версия на клиенте в момент изменения
 * - Если baseVersion < server.version → конфликт
 */

import type { VectorClockData } from '@/shared/sync/vector-clock';

export type UUID = string;

export type EntityType = 'report' | 'pile_work' | 'drilling' | 'downtime';
export type OperationType = 'upsert' | 'delete';
export type ConflictReason = 'version_conflict' | 'deleted_on_server' | 'concurrent_modification';
export type ConflictStrategy = 'server_wins' | 'client_wins' | 'field_merge' | 'vector_clock_merge';
export type SyncStatus = 'idle' | 'syncing' | 'failed' | 'synced';

// ============================================================
// Base Entity
// ============================================================

export interface BaseEntity {
  id: UUID;
  tenantId: UUID;
  version: number;          // монотонно возрастает (server-controlled)
  updatedAt: string;        // ISO timestamp
  deviceId: string;         // идентификатор устройства-автора
  vectorClock?: VectorClockData; // causal ordering для distributed sync
  deleted?: boolean;
}

// ============================================================
// Report Entity
// ============================================================

export interface ReportEntity extends BaseEntity {
  type: 'report';
  status: 'draft' | 'submitted';
  userId: string;
  siteId: string;
  date: string;
  shiftType: 'day' | 'night';
  shiftStart: string | null;
  shiftEnd: string | null;
  equipmentId: string | null;
  // Данные отчёта (нормализованные)
  piles: { pileGradeId: string; count: number }[];
  drillings: { typeId: string; meters: number }[];
  downtimes: { reasonId: string; duration: number; comment: string | null }[];
}

// ============================================================
// Local Change (клиент → сервер)
// ============================================================

export interface LocalChange<T = unknown> {
  entity: EntityType;
  op: OperationType;
  data: T;
  baseVersion: number;    // версия на клиенте в момент изменения
  opId: string;           // UUID операции (для идемпотентности)
  vectorClock?: VectorClockData; // causal ordering (new in v3)
}

// ============================================================
// Sync Request (клиент → сервер)
// ============================================================

export interface SyncRequest {
  deviceId: string;
  tenantId: string;
  userId: string;
  lastSyncAt: string;     // ISO timestamp последнего успешного sync
  changes: LocalChange[];
}

// ============================================================
// Server Change (сервер → клиент)
// ============================================================

export interface ServerChange<T = unknown> {
  entity: EntityType;
  op: OperationType;
  data: T;
  vectorClock?: VectorClockData; // causal ordering (new in v3)
}

// ============================================================
// Conflict
// ============================================================

export interface Conflict<T = unknown> {
  entity: EntityType;
  clientData: T;
  serverData: unknown;
  reason: ConflictReason;
  conflictType?: 'version_conflict' | 'concurrent'; // LWW vs vector clock
  resolvedData?: T;       // если авто-разрешён
  vectorClock?: VectorClockData; // merged vector clock after resolution
}

// ============================================================
// Sync Response (сервер → клиент)
// ============================================================

export interface SyncResponse {
  serverChanges: ServerChange[];
  conflicts: Conflict[];
  newSyncAt: string;      // ISO timestamp — использовать как lastSyncAt
  syncStatus: SyncStatus;
  stats: {
    applied: number;      // успешно применено
    conflicts: number;    // обнаружено конфликтов
    skipped: number;      // пропущено (идемпотентные дубликаты)
  };
}

// ============================================================
// Device Sync State
// ============================================================

export interface DeviceSyncState {
  deviceId: string;
  tenantId: string;
  userId: string | null;
  lastSyncAt: string;
  syncStatus: SyncStatus;
  lastError: string | null;
  changesSent: number;
  changesRecv: number;
  createdAt: string;
  updatedAt: string;
  lastVectorClock?: VectorClockData; // last known VC for this device (new in v3)
}
