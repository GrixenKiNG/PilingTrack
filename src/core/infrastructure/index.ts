/**
 * Core Infrastructure — Prisma, Outbox, Storage, Repositories, Audit
 */

export { db, getDatabaseProvider } from '@/lib/db';

// Legacy outbox (backward compatible)
export { saveToOutbox, publishOutboxEvents, startOutboxWorker, getOutboxStats } from '@/services/reports/outbox-publisher';

// New modular repository
export { getReportRepository, PrismaReportRepository } from '@/modules/reports/infrastructure';
export type { ReportRepository } from '@/modules/reports/infrastructure';

// Audit Log (immutable, append-only)
export {
  recordAuditLog,
  recordAuditLogWithDiff,
  getAuditLogsByEntity,
  getAuditLogsByUser,
  getAuditLogsByTenant,
  getAuditLogStats,
} from './audit-log-service';
export type { AuditLogEntry } from './audit-log-service';
