/**
 * Reports Module — Bounded Context
 *
 * All report-related functionality in one vertical slice:
 * - domain/   : Aggregates, value objects, domain events
 * - application/ : Commands, queries, services, event handlers, projections
 * - infrastructure/ : Repositories, Prisma mappers
 * - api/ : Next.js route handlers
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

// Event Bus
export { on, emitDomainEvent, getRegisteredEventTypes } from './application/event-bus';

// Projections
export { startProjectionWorker } from './application/projections/projection-worker';

// Infrastructure
export { getReportRepository, PrismaReportRepository } from './infrastructure';
export type { ReportRepository } from './infrastructure';
