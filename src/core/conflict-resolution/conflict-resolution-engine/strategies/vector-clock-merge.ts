import { mergeWithVectorClocks } from '@/core/shared/sync/vector-clock';
import type {
  ConflictContext,
  ConflictFieldDetail,
  ConflictResolutionResult,
  ConflictStrategyName,
  MergeStrategy,
} from '../types';

/**
 * Strategy 4: Vector Clock Merge (for concurrent modifications)
 *
 * Used when both sides have vector clocks and clocks indicate concurrency
 * (neither happened-before the other).
 */
export class VectorClockMergeStrategy implements MergeStrategy {
  readonly name: ConflictStrategyName = 'vector_clock_merge';

  canResolve(ctx: ConflictContext): boolean {
    return !!(ctx.clientVectorClock && ctx.serverVectorClock);
  }

  resolve(ctx: ConflictContext): ConflictResolutionResult {
    const mergeResult = mergeWithVectorClocks(
      ctx.clientData,
      ctx.serverData,
      ctx.clientVectorClock!,
      ctx.serverVectorClock!
    );

    const merged = { ...mergeResult.merged } as Record<string, unknown>;
    merged.version = (ctx.serverVersion || 0) + 1;
    merged.updatedAt = new Date().toISOString();

    const mergedVC = { ...mergeResult.mergedVC };
    mergedVC['server'] = (mergedVC['server'] || 0) + 1;

    const conflictFields: ConflictFieldDetail[] = mergeResult.conflictFields.map((f: string) => ({
      field: f,
      clientValue: ctx.clientData[f],
      serverValue: ctx.serverData[f],
      winner: 'merged' as const,
      strategy: 'vector_clock_merge',
    }));

    return {
      merged,
      strategy: 'vector_clock_merge',
      conflictFields,
      hasConflicts: conflictFields.length > 0,
      vectorClock: mergedVC,
      auditEntry: {
        timestamp: new Date().toISOString(),
        entityId: ctx.entityId,
        entityType: ctx.entityType,
        conflictType: 'concurrent',
        resolutionStrategy: 'vector_clock_merge',
        fieldsInConflict: conflictFields.map((f) => f.field),
        resolutionDetails: conflictFields,
        deviceId: ctx.deviceId,
      },
    };
  }
}
