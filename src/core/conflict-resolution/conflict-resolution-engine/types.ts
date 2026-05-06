import type { VectorClockData } from '@/core/shared/sync/vector-clock';

export type ConflictStrategyName = 'lww' | 'server_wins' | 'client_wins' | 'field_merge' | 'vector_clock_merge';
export type ConflictResolutionMode = 'auto' | 'manual';

export interface ConflictFieldDetail {
  field: string;
  clientValue: unknown;
  serverValue: unknown;
  winner: 'client' | 'server' | 'merged';
  strategy: string;
}

export interface ConflictResolutionResult<T = Record<string, unknown>> {
  merged: T;
  strategy: ConflictStrategyName;
  conflictFields: ConflictFieldDetail[];
  hasConflicts: boolean;
  vectorClock: VectorClockData;
  auditEntry: ConflictAuditEntry;
}

export interface ConflictAuditEntry {
  timestamp: string;
  entityId: string;
  entityType: string;
  conflictType: 'version' | 'concurrent' | 'semantic';
  resolutionStrategy: ConflictStrategyName;
  fieldsInConflict: string[];
  resolutionDetails: ConflictFieldDetail[];
  deviceId: string;
}

export interface ConflictContext {
  entityId: string;
  entityType: string;
  clientData: Record<string, unknown>;
  serverData: Record<string, unknown>;
  clientVectorClock?: VectorClockData;
  serverVectorClock?: VectorClockData;
  clientVersion: number;
  serverVersion: number;
  deviceId: string;
  tenantId: string;
  userId: string;
}

export interface MergeStrategy {
  name: ConflictStrategyName;
  /** Returns true if this strategy can handle the given context */
  canResolve(ctx: ConflictContext): boolean;
  /** Resolve conflict — must be deterministic */
  resolve(ctx: ConflictContext): ConflictResolutionResult;
}
