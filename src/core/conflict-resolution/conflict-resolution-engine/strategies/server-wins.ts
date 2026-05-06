import { VectorClock } from '@/core/shared/sync/vector-clock';
import { findDifferentFields } from '../helpers';
import type {
  ConflictContext,
  ConflictFieldDetail,
  ConflictResolutionResult,
  ConflictStrategyName,
  MergeStrategy,
} from '../types';

/**
 * Strategy 2: Server Wins (for business-critical fields)
 *
 * Used when server data is clearly authoritative — submitted/archived reports
 * cannot be silently overwritten by client edits.
 */
export class ServerWinsStrategy implements MergeStrategy {
  readonly name: ConflictStrategyName = 'server_wins';

  canResolve(ctx: ConflictContext): boolean {
    const status = ctx.serverData.status;
    return status === 'submitted' || status === 'archived';
  }

  resolve(ctx: ConflictContext): ConflictResolutionResult {
    const conflictFields: ConflictFieldDetail[] = findDifferentFields(
      ctx.clientData,
      ctx.serverData
    ).map((f) => ({
      field: f,
      clientValue: ctx.clientData[f],
      serverValue: ctx.serverData[f],
      winner: 'server' as const,
      strategy: 'server_wins',
    }));

    const vc = ctx.clientVectorClock && ctx.serverVectorClock
      ? VectorClock.mergeClocks(ctx.clientVectorClock, ctx.serverVectorClock)
      : (ctx.clientVectorClock || ctx.serverVectorClock || {});

    const serverVC = new VectorClock('server', vc);
    serverVC.increment();
    const mergedVC = serverVC.snapshot();

    return {
      merged: {
        ...ctx.serverData,
        updatedAt: new Date().toISOString(),
        vectorClock: mergedVC,
      } as Record<string, unknown>,
      strategy: 'server_wins',
      conflictFields,
      hasConflicts: conflictFields.length > 0,
      vectorClock: mergedVC,
      auditEntry: {
        timestamp: new Date().toISOString(),
        entityId: ctx.entityId,
        entityType: ctx.entityType,
        conflictType: 'version',
        resolutionStrategy: 'server_wins',
        fieldsInConflict: conflictFields.map((f) => f.field),
        resolutionDetails: conflictFields,
        deviceId: ctx.deviceId,
      },
    };
  }
}
