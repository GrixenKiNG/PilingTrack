/**
 * Sync Engine v2 — Production-grade sync with Vector Clock conflict resolution.
 *
 * Public API:
 *   handleSync(request)               — main sync handler
 *   updateDeviceSyncState(...)        — used after sync completes
 *   initDeviceSyncState(...)          — used at sync start
 *   getDeviceSyncStatus(deviceId)     — read state
 *   getTenantDeviceSyncStates(tid)    — admin read
 *
 * Internal split:
 *   idempotency.ts       — opId-based idempotency
 *   report-processor.ts  — processReportChange (conflict detection + resolution)
 *   server-changes.ts    — getServerChanges (pull recent server data)
 *   device-state.ts      — DeviceSyncState CRUD
 *   handler.ts           — handleSync orchestration
 */

export { resolveConflict } from '@/core/shared/sync/conflict-resolver';
export {
  determineConflictType,
  mergeWithVectorClocks,
  VectorClock,
} from '@/core/shared/sync/vector-clock';
export type {
  VectorClockData,
  VectorClockRelation,
} from '@/core/shared/sync/vector-clock';
export type {
  Conflict,
  ConflictStrategy,
  EntityType,
  LocalChange,
  OperationType,
  ServerChange,
  SyncRequest,
  SyncResponse,
  SyncStatus,
} from '@/core/shared/types/sync';

export {
  getDeviceSyncStatus,
  getTenantDeviceSyncStates,
  initDeviceSyncState,
  updateDeviceSyncState,
} from './device-state';
export { handleSync } from './handler';
