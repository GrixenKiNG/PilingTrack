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

// eslint-disable-next-line no-restricted-imports -- intentional public re-export facade; implementation stays in services/ until the services->modules migration completes (CLAUDE.md)
export {
  upsertReport,
  assertCanActForUser,
  resolveReportUserId,
} from '@/modules/reports/application/commands/report-command.service';

// eslint-disable-next-line no-restricted-imports -- intentional public re-export facade; implementation stays in services/ until the services->modules migration completes (CLAUDE.md)
export {
  validateReportInput,
  validateAgainstSitePlans,
} from '@/modules/reports/application/commands/report-validation.service';

// eslint-disable-next-line no-restricted-imports -- intentional public re-export facade; implementation stays in services/ until the services->modules migration completes (CLAUDE.md)
export type {
  UpsertReportCommand,
  UpsertReportResult,
} from '@/modules/reports/application/commands/upsert-report.command';

// ============================================================
// Queries (read operations) — delegates to DDD module
// ============================================================

// eslint-disable-next-line no-restricted-imports -- intentional public re-export facade; implementation stays in services/ until the services->modules migration completes (CLAUDE.md)
export {
  listReportsForUserScope,
  listReportsForReview,
} from '@/modules/reports/application/queries/report-query.service';

// ============================================================
// Repository — single write path
// ============================================================

// eslint-disable-next-line no-restricted-imports -- intentional public re-export facade; implementation stays in services/ until the services->modules migration completes (CLAUDE.md)
export {
  getReportRepository,
} from '@/modules/reports/infrastructure/report.repository';

// ============================================================
// Domain — aggregate and events
// ============================================================

// eslint-disable-next-line no-restricted-imports -- intentional public re-export facade; implementation stays in services/ until the services->modules migration completes (CLAUDE.md)
export {
  ReportAggregate,
} from '@/modules/reports/domain/report.aggregate';

// eslint-disable-next-line no-restricted-imports -- intentional public re-export facade; implementation stays in services/ until the services->modules migration completes (CLAUDE.md)
export type {
  PileWorkEntry,
  DrillingEntry,
  DowntimeEntry,
  ReportStatus,
  ShiftType,
} from '@/modules/reports/domain/report.aggregate';

// eslint-disable-next-line no-restricted-imports -- intentional public re-export facade; implementation stays in services/ until the services->modules migration completes (CLAUDE.md)
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
