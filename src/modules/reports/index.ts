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
  calculateReportSummary,
  calculatePeriodSummary,
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
  getDashboardStats,
  reportDetailInclude,
  // CQRS Read Model queries
  getReportStats,
  getSiteDailyStats,
  getSiteDashboard,
  getOperatorPerformance,
  getSiteOperatorPerformance,
  getOperatorLeaderboard,
  getDowntimeSummary,
  getDowntimeTrend,
  getTopDowntimeReasons,
  getWeeklyTrend,
  getWeeklyTrends,
  getFullDashboard,
} from './application';
export type { DashboardData } from './application';

// Event Bus — re-exported from the legacy bus (per ADR-0006 addendum
// 2026-05-21, the modern wrapper at ./application/event-bus was deleted).
// Kept for backward compatibility with any caller importing through
// the @/modules/reports barrel.
// eslint-disable-next-line no-restricted-imports -- intentional public re-export facade; implementation stays in services/ until the services->modules migration completes (CLAUDE.md)
export { on, emitDomainEvent, getRegisteredEventTypes } from '@/services/reports/domain-events';

// Projections
export { startProjectionWorker } from './application/projections/projection-worker';

// Infrastructure
export { getReportRepository, PrismaReportRepository } from './infrastructure';
export type { ReportRepository } from './infrastructure';
