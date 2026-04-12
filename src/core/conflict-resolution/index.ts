export {
  ConflictResolutionEngine,
  createReportConflictEngine,
  LastWriteWinsStrategy,
  ServerWinsStrategy,
  FieldMergeStrategy,
  VectorClockMergeStrategy,
} from './conflict-resolution-engine';

export type {
  ConflictStrategyName,
  ConflictResolutionMode,
  ConflictFieldDetail,
  ConflictResolutionResult,
  ConflictAuditEntry,
  ConflictContext,
  MergeStrategy,
} from './conflict-resolution-engine';
