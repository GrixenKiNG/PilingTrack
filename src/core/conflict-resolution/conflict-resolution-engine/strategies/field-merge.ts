import { VectorClock, type VectorClockData } from '@/core/shared/sync/vector-clock';
import { classifyField } from '../classification';
import { mergeCollections } from '../collection-mergers';
import type {
  ConflictContext,
  ConflictFieldDetail,
  ConflictResolutionResult,
  ConflictStrategyName,
  MergeStrategy,
} from '../types';

/**
 * Strategy 3: Field Merge (default intelligent merge)
 *
 * Walks every field, classifies it, and applies the appropriate per-field
 * resolution: serverAuthoritative/businessCritical → server, temporal → newer
 * timestamp, collections → semantic merger, default → client.
 */
export class FieldMergeStrategy implements MergeStrategy {
  readonly name: ConflictStrategyName = 'field_merge';

  canResolve(_ctx: ConflictContext): boolean {
    return true; // Always applicable
  }

  resolve(ctx: ConflictContext): ConflictResolutionResult {
    const merged: Record<string, unknown> = { ...ctx.serverData };
    const conflictFields: ConflictFieldDetail[] = [];

    const allKeys = new Set([
      ...Object.keys(ctx.clientData),
      ...Object.keys(ctx.serverData),
    ]);

    for (const key of allKeys) {
      if (key === 'vectorClock' || key === 'version') continue;

      const clientVal = ctx.clientData[key];
      const serverVal = ctx.serverData[key];

      if (JSON.stringify(clientVal) === JSON.stringify(serverVal)) continue;

      if (clientVal === undefined) continue; // Client removed → keep server
      if (serverVal === undefined) {
        merged[key] = clientVal; // Client added → accept
        continue;
      }

      const classification = classifyField(key);

      switch (classification) {
        case 'serverAuthoritative':
          conflictFields.push({
            field: key,
            clientValue: clientVal,
            serverValue: serverVal,
            winner: 'server',
            strategy: 'field_merge.authoritative',
          });
          break;

        case 'businessCritical':
          conflictFields.push({
            field: key,
            clientValue: clientVal,
            serverValue: serverVal,
            winner: 'server',
            strategy: 'field_merge.critical',
          });
          break;

        case 'temporal':
          merged[key] = clientVal;
          conflictFields.push({
            field: key,
            clientValue: clientVal,
            serverValue: serverVal,
            winner: 'client',
            strategy: 'field_merge.temporal',
          });
          break;

        case 'collections':
          // Handled separately below
          break;

        default:
          merged[key] = clientVal;
          conflictFields.push({
            field: key,
            clientValue: clientVal,
            serverValue: serverVal,
            winner: 'client',
            strategy: 'field_merge.default',
          });
      }
    }

    const collectionResults = mergeCollections(ctx.clientData, ctx.serverData);
    for (const [key, value] of collectionResults) {
      merged[key] = value;
      conflictFields.push({
        field: key,
        clientValue: ctx.clientData[key],
        serverValue: ctx.serverData[key],
        winner: 'merged',
        strategy: `field_merge.semantic.${key}`,
      });
    }

    let mergedVC: VectorClockData;
    if (ctx.clientVectorClock && ctx.serverVectorClock) {
      mergedVC = VectorClock.mergeClocks(ctx.clientVectorClock, ctx.serverVectorClock);
      const serverVC = new VectorClock('server', mergedVC);
      serverVC.increment();
      mergedVC = serverVC.snapshot();
    } else {
      mergedVC = ctx.clientVectorClock || ctx.serverVectorClock || {};
    }

    merged.version = (ctx.serverVersion || 0) + 1;
    merged.vectorClock = mergedVC;
    merged.updatedAt = new Date().toISOString();

    return {
      merged,
      strategy: 'field_merge',
      conflictFields,
      hasConflicts: conflictFields.length > 0,
      vectorClock: mergedVC,
      auditEntry: {
        timestamp: new Date().toISOString(),
        entityId: ctx.entityId,
        entityType: ctx.entityType,
        conflictType: 'concurrent',
        resolutionStrategy: 'field_merge',
        fieldsInConflict: conflictFields.map((f) => f.field),
        resolutionDetails: conflictFields,
        deviceId: ctx.deviceId,
      },
    };
  }
}
