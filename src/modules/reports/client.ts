/**
 * Client-safe entry: pure data and functions, no database, no node:*.
 * Purity is enforced by src/modules/__tests__/client-entry-purity.test.ts.
 */
export {
  isShiftTypeSelectable,
  SELECTABLE_SHIFT_TYPES,
} from './domain/shift-types';
export {
  statusLabel,
} from './application/report-history';
export type {
  ReportHistory,
} from './application/report-history';
