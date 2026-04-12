/**
 * Reports Service — Facade
 *
 * Delegates to the DDD module layer (src/modules/reports).
 * Legacy services are deprecated — this facade ensures all consumers
 * use the modern DDD implementation.
 *
 * @deprecated Import directly from @/modules/reports instead.
 * This facade will be removed in the next major version.
 */

// ============================================================
// Commands (write operations) — delegates to DDD module
// ============================================================

export {
  upsertReport,
  assertCanActForUser,
  resolveReportUserId,
} from '@/modules/reports/application/commands/report-command.service';

export {
  validateReportInput,
  validateAgainstSitePlans,
} from '@/modules/reports/application/commands/report-validation.service';

export type {
  UpsertReportCommand,
  UpsertReportResult,
} from '@/modules/reports/application/commands/upsert-report.command';

// ============================================================
// Queries (read operations) — delegates to DDD module
// ============================================================

export {
  listReportsForUserScope,
  listReportsForReview,
} from '@/modules/reports/application/queries/report-query.service';

// ============================================================
// Repository — single write path
// ============================================================

export {
  getReportRepository,
} from '@/modules/reports/infrastructure/report.repository';

// ============================================================
// Domain — aggregate and events
// ============================================================

export {
  ReportAggregate,
} from '@/modules/reports/domain/report.aggregate';

export type {
  PileWorkEntry,
  DrillingEntry,
  DowntimeEntry,
  ReportStatus,
  ShiftType,
} from '@/modules/reports/domain/report.aggregate';

export type {
  ReportDomainEvent,
  ReportDomainEventType,
} from '@/modules/reports/domain/report.events';

// ============================================================
// Event handlers — delegates to core event bus
// ============================================================

export {
  registerAllEventHandlers,
} from '@/services/reports/event-handlers';
