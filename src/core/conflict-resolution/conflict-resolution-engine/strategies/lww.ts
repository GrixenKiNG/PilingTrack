import { VectorClock } from '@/core/shared/sync/vector-clock';
import { findDifferentFields, parseTimestamp } from '../helpers';
import type {
  ConflictContext,
  ConflictFieldDetail,
  ConflictResolutionResult,
  ConflictStrategyName,
  MergeStrategy,
} from '../types';

/**
 * Strategy 1: Last-Write-Wins (fallback, for backward compat)
 */
export class LastWriteWinsStrategy implements MergeStrategy {
  readonly name: ConflictStrategyName = 'lww';

  canResolve(_ctx: ConflictContext): boolean {
    return true; // Always applicable as fallback
  }

  resolve(ctx: ConflictContext): ConflictResolutionResult {
    const clientTime = parseTimestamp(ctx.clientData.updatedAt);
    const serverTime = parseTimestamp(ctx.serverData.updatedAt);
    const merged = clientTime >= serverTime ? ctx.clientData : ctx.serverData;
    const winner = clientTime >= serverTime ? 'client' : 'server';

    const conflictFields: ConflictFieldDetail[] = findDifferentFields(
      ctx.clientData,
      ctx.serverData
    ).map((f) => ({
      field: f,
      clientValue: ctx.clientData[f],
      serverValue: ctx.serverData[f],
      winner,
      strategy: 'lww',
    }));

    const vc = ctx.clientVectorClock && ctx.serverVectorClock
      ? VectorClock.mergeClocks(ctx.clientVectorClock, ctx.serverVectorClock)
      : (ctx.clientVectorClock || ctx.serverVectorClock || {});

    return {
      merged: merged as Record<string, unknown>,
      strategy: 'lww',
      conflictFields,
      hasConflicts: conflictFields.length > 0,
      vectorClock: vc,
      auditEntry: {
        timestamp: new Date().toISOString(),
        entityId: ctx.entityId,
        entityType: ctx.entityType,
        conflictType: 'version',
        resolutionStrategy: 'lww',
        fieldsInConflict: conflictFields.map((f) => f.field),
        resolutionDetails: conflictFields,
        deviceId: ctx.deviceId,
      },
    };
  }
}
