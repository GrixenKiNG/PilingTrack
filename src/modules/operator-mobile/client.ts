/**
 * Client-safe entry: pure data and functions, no database, no node:*.
 * Purity is enforced by src/modules/__tests__/client-entry-purity.test.ts.
 */
export * from './contracts';
export {
  DEFECT_SEVERITY_FIELD_LABELS,
  DEFECT_STATUS_FIELD_LABELS,
  isAlarmingSeverity,
} from './domain/defect-labels';
export {
  DEFAULT_SET_BLOWS,
  journalRefusalMm,
  PILE_ACCEPTANCE_LABELS,
  REFUSAL_SET_WINDOW,
  refusalExceedsDesign,
  setRefusalMm,
  validatePassport,
} from './domain/pile-passport';
export type {
  PileAcceptanceValue,
} from './domain/pile-passport';
export {
  PHASE_CHECKLIST,
  PHASE_LABELS,
} from './domain/shift-phases';
