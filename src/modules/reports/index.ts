/**
 * Reports Module — Bounded Context
 *
 * All report-related functionality in one vertical slice:
 * - domain/   : Aggregates, value objects, domain events
 * - application/ : Commands, queries, services, event handlers, projections
 * - infrastructure/ : Repositories, Prisma mappers
 *
 * HTTP route handlers live under src/app/api/reports/** and import from this
 * barrel — there is intentionally no api/ folder here.
 */

// Domain
export { ReportAggregate } from './domain';
export type {
  PileWorkEntry,
  DrillingEntry,
  DowntimeEntry,
  ReportStatus,
  ShiftType,
} from './domain';
export { createReportEvent } from './domain';
export type { ReportDomainEvent, ReportDomainEventType } from './domain';

// Application — Commands
export {
  upsertReport,
  resolveReportUserId,
  assertCanActForUser,
  validateReportInput,
  validateDowntimeWithinShift,
} from './application';
export type { UpsertReportCommand, UpsertReportResult } from './application';

// Application — Queries (including CQRS)
export {
  getEditableReport,
  getReportsByPeriod,
  listReportsForReview,
  listRecentReportsForDashboard,
  listReportsForUserScope,
  exportReportsCsv,
  exportReportsXlsx,
  getDashboardStats,
  reportDetailInclude,
} from './application';

// Event Bus — re-exported from the legacy bus (per ADR-0006 addendum
// 2026-05-21, the modern wrapper at ./application/event-bus was deleted).
// Kept for backward compatibility with any caller importing through
// the @/modules/reports barrel.
export { on, emitDomainEvent, getRegisteredEventTypes } from './application/domain-events';

// Projections
export { startProjectionWorker } from './application/projections/projection-worker';

// Infrastructure
export { getReportRepository, PrismaReportRepository } from './infrastructure';
export type { ReportRepository } from './infrastructure';

// Public exports for routes and screens (previously deep imports).
export {
  rebuildAll,
  rebuildReportAnalytics,
  rebuildSiteDailySummary,
  rebuildSiteWeeklyTrend,
} from './application/projections/rebuild';
export type {
  ProjectionName,
  RebuildResult,
} from './application/projections/rebuild';
export {
  decidePilePassport,
  exportPileJournalXlsx,
  listPilePassports,
  pileJournalHeader,
} from './application/queries/pile-passport.service';
export type {
  PileJournalHeader,
  PilePassportRow,
} from './application/queries/pile-passport.service';
export {
  computePeriodSummary,
} from './domain/period-summary';
export type {
  PeriodReportInput,
} from './domain/period-summary';
export { saveReportEndingEngineHours } from './infrastructure/report.repository';
export {
  getReportHistory,
} from './application/report-history-service';
