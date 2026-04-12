/**
 * Core Shared Kernel — Domain Layer
 *
 * Re-exports domain primitives available to all modules.
 * Primary source: modules/reports/domain (new modular structure)
 * Legacy aliases kept for backward compatibility.
 */

export * from '@/modules/reports/domain';
// Legacy alias — new code should import from @/modules/reports
export { ReportAggregate } from '@/modules/reports/domain';
export type {
  PileWorkEntry,
  DrillingEntry,
  DowntimeEntry,
  ReportStatus,
  ShiftType,
} from '@/modules/reports/domain';
