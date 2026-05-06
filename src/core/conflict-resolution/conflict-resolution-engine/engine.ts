import { determineConflictType } from '@/core/shared/sync/vector-clock';
import { FieldMergeStrategy } from './strategies/field-merge';
import { LastWriteWinsStrategy } from './strategies/lww';
import { ServerWinsStrategy } from './strategies/server-wins';
import { VectorClockMergeStrategy } from './strategies/vector-clock-merge';
import type {
  ConflictContext,
  ConflictResolutionResult,
  ConflictStrategyName,
  MergeStrategy,
} from './types';

export class ConflictResolutionEngine {
  private strategies: Map<ConflictStrategyName, MergeStrategy>;

  constructor(strategies: MergeStrategy[]) {
    this.strategies = new Map();
    for (const strategy of strategies) {
      this.strategies.set(strategy.name, strategy);
    }
  }

  /**
   * Resolve a conflict between client and server data.
   *
   * Strategy selection priority:
   * 1. vector_clock_merge (if both VCs present and concurrent)
   * 2. server_wins (if server status is submitted/archived)
   * 3. field_merge (default intelligent merge)
   * 4. lww (fallback)
   */
  resolve(ctx: ConflictContext): ConflictResolutionResult {
    const conflictType = ctx.clientVectorClock && ctx.serverVectorClock
      ? determineConflictType(ctx.clientVectorClock, ctx.serverVectorClock)
      : null;

    const strategyOrder: ConflictStrategyName[] = [
      'vector_clock_merge',
      'server_wins',
      'field_merge',
      'lww',
    ];

    for (const strategyName of strategyOrder) {
      const strategy = this.strategies.get(strategyName);
      if (!strategy) continue;

      // Skip vector_clock_merge if not concurrent
      if (strategyName === 'vector_clock_merge' && conflictType !== 'concurrent') {
        continue;
      }

      if (strategy.canResolve(ctx)) {
        return strategy.resolve(ctx);
      }
    }

    throw new Error('No strategy could resolve conflict');
  }

  getRegisteredStrategies(): ConflictStrategyName[] {
    return Array.from(this.strategies.keys());
  }

  registerStrategy(strategy: MergeStrategy): void {
    this.strategies.set(strategy.name, strategy);
  }
}

/**
 * Pre-configured engine for report conflicts.
 */
export function createReportConflictEngine(): ConflictResolutionEngine {
  return new ConflictResolutionEngine([
    new VectorClockMergeStrategy(),
    new ServerWinsStrategy(),
    new FieldMergeStrategy(),
    new LastWriteWinsStrategy(),
  ]);
}
