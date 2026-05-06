/**
 * Conflict Resolution Engine v2 — Production-grade
 *
 * Multi-strategy conflict resolution for offline-first sync:
 * - LWW → field_merge → vector_clock_merge → server_wins
 * - Field-level conflict tracking (which fields conflicted, who won)
 * - Semantic merge for collections (piles, drillings, downtimes)
 * - Conflict audit trail (who, when, what, why)
 * - Pluggable merge strategies (open/closed principle)
 * - Deterministic — same inputs → same output (critical for replay)
 *
 * Usage:
 *   const engine = createReportConflictEngine();
 *   const result = engine.resolve({ clientData, serverData, ... });
 *
 * Internal split:
 *   types.ts                — public types (Context, Result, Strategy interface)
 *   classification.ts       — REPORT_FIELD_CLASSIFICATION + classifyField
 *   helpers.ts              — findDifferentFields, parseTimestamp, isRecord
 *   collection-mergers.ts   — mergePiles/Drillings/Downtimes + mergeCollections
 *   strategies/lww.ts             — LastWriteWinsStrategy
 *   strategies/server-wins.ts     — ServerWinsStrategy
 *   strategies/field-merge.ts     — FieldMergeStrategy (default)
 *   strategies/vector-clock-merge.ts — VectorClockMergeStrategy
 *   engine.ts               — ConflictResolutionEngine + createReportConflictEngine
 */

export {
  ConflictResolutionEngine,
  createReportConflictEngine,
} from './engine';
export { FieldMergeStrategy } from './strategies/field-merge';
export { LastWriteWinsStrategy } from './strategies/lww';
export { ServerWinsStrategy } from './strategies/server-wins';
export { VectorClockMergeStrategy } from './strategies/vector-clock-merge';
export type {
  ConflictAuditEntry,
  ConflictContext,
  ConflictFieldDetail,
  ConflictResolutionMode,
  ConflictResolutionResult,
  ConflictStrategyName,
  MergeStrategy,
} from './types';
