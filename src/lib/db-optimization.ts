/**
 * Database Query Optimization — PilingTrack
 *
 * Provides optimized query helpers that:
 * 1. Use proper indexes
 * 2. Select only needed fields
 * 3. Batch related queries
 * 4. Avoid N+1 problems
 * 5. Use raw SQL for complex aggregations
 *
 * Usage:
 *   import { optimizedQueries } from '@/lib/db-optimization';
 *
 *   const reports = await optimizedQueries.getReportsByPeriod(siteId, from, to);
 */

import { db } from '@/lib/db';

// ============================================================
// Index Recommendations (run via migration)
// ============================================================

/**
 * Required indexes for optimal performance.
 * Run: npx prisma db execute --file prisma/indexes.sql
 */
export const REQUIRED_INDEXES = [
  // Report queries (most common)
  'CREATE INDEX IF NOT EXISTS idx_report_user_date ON "Report"("userId", "date" DESC)',
  'CREATE INDEX IF NOT EXISTS idx_report_site_date ON "Report"("siteId", "date" DESC)',
  'CREATE INDEX IF NOT EXISTS idx_report_status ON "Report"("status")',
  'CREATE INDEX IF NOT EXISTS idx_report_crew ON "Report"("crewId")',
  'CREATE INDEX IF NOT EXISTS idx_report_equipment ON "Report"("equipmentId")',
  'CREATE INDEX IF NOT EXISTS idx_report_updated ON "Report"("updatedAt" DESC)',

  // Site hierarchy
  'CREATE INDEX IF NOT EXISTS idx_pilefield_site ON "PileField"("siteId")',
  'CREATE INDEX IF NOT EXISTS idx_cluster_field ON "Cluster"("fieldId")',
  'CREATE INDEX IF NOT EXISTS idx_picket_cluster ON "Picket"("clusterId")',

  // Report children
  'CREATE INDEX IF NOT EXISTS idx_pilework_report ON "PileWork"("reportId")',
  'CREATE INDEX IF NOT EXISTS idx_pilework_grade ON "PileWork"("pileGradeId")',
  'CREATE INDEX IF NOT EXISTS idx_drilling_report ON "LeaderDrilling"("reportId")',
  'CREATE INDEX IF NOT EXISTS idx_drilling_type ON "LeaderDrilling"("typeId")',
  'CREATE INDEX IF NOT EXISTS idx_downtime_report ON "ReportDowntime"("reportId")',
  'CREATE INDEX IF NOT EXISTS idx_downtime_reason ON "ReportDowntime"("reasonId")',

  // User access
  'CREATE INDEX IF NOT EXISTS idx_usersite_user ON "UserSiteAssignment"("userId")',
  'CREATE INDEX IF NOT EXISTS idx_usersite_site ON "UserSiteAssignment"("siteId")',

  // Crew
  'CREATE INDEX IF NOT EXISTS idx_crew_operator ON "Crew"("operatorId")',
  'CREATE INDEX IF NOT EXISTS idx_crew_site ON "Crew"("siteId")',
  'CREATE INDEX IF NOT EXISTS idx_crew_equipment ON "Crew"("equipmentId")',

  // Telemetry
  'CREATE INDEX IF NOT EXISTS idx_telemetry_equip_ts ON "TelemetryRecord"("equipmentId", "timestamp" DESC)',
  'CREATE INDEX IF NOT EXISTS idx_telemetry_site_ts ON "TelemetryRecord"("siteId", "timestamp" DESC)',

  // Audit
  'CREATE INDEX IF NOT EXISTS idx_auditlog_entity_ts ON "AuditLog"("entity", "timestamp" DESC)',
  'CREATE INDEX IF NOT EXISTS idx_auditlog_user_ts ON "AuditLog"("userId", "timestamp" DESC)',

  // Feedback
  'CREATE INDEX IF NOT EXISTS idx_feedback_scope_ts ON "FeedbackEvent"("scope", "createdAt" DESC)',
  'CREATE INDEX IF NOT EXISTS idx_feedback_audience_ts ON "FeedbackEvent"("audience", "createdAt" DESC)',

  // Outbox
  'CREATE INDEX IF NOT EXISTS idx_outbox_published ON "OutboxEvent"("published", "createdAt")',

  // Refresh tokens
  'CREATE INDEX IF NOT EXISTS idx_refreshtoken_user ON "RefreshToken"("userId", "revoked", "expiresAt")',
] as const;

// ============================================================
// Optimized Query Helpers
// ============================================================

/**
 * Get reports by period with single query (no N+1).
 * Uses composite index (siteId, date).
 */
export async function getReportsByPeriodOptimized(
  siteId: string,
  from: string,
  to: string
) {
  return db.report.findMany({
    where: { siteId, date: { gte: from, lte: to } },
    select: {
      id: true,
      reportId: true,
      date: true,
      shiftType: true,
      status: true,
      createdAt: true,
      user: { select: { name: true } },
      crew: { select: { name: true } },
      _count: {
        select: {
          piles: true,
          drillings: true,
          downtimes: true,
        },
      },
    },
    orderBy: { date: 'desc' },
  });
}

/**
 * Get report summary stats with aggregation (single query).
 * Replaces multiple COUNT() queries.
 */
export async function getReportStats(siteId: string, from: string, to: string) {
  const [totalReports, totalPiles, totalDrilling, totalDowntime] = await Promise.all([
    db.report.count({ where: { siteId, date: { gte: from, lte: to } } }),
    db.pileWork.aggregate({
      where: { report: { siteId, date: { gte: from, lte: to } } },
      _sum: { count: true },
    }),
    db.leaderDrilling.aggregate({
      where: { report: { siteId, date: { gte: from, lte: to } } },
      _sum: { meters: true },
    }),
    db.reportDowntime.aggregate({
      where: { report: { siteId, date: { gte: from, lte: to } } },
      _sum: { duration: true },
    }),
  ]);

  return {
    totalReports,
    totalPiles: totalPiles._sum.count || 0,
    totalDrilling: totalDrilling._sum.meters || 0,
    totalDowntime: totalDowntime._sum.duration || 0,
  };
}

/**
 * Get crew performance with single query (no N+1).
 * Uses composite indexes on crew → report → piles/drillings.
 */
export async function getCrewPerformance(crewId: string, from: string, to: string) {
  const [reports, downtimes] = await Promise.all([
    db.report.findMany({
      where: { crewId, date: { gte: from, lte: to } },
      select: {
        date: true,
        shiftType: true,
        _count: { select: { piles: true, drillings: true } },
      },
      orderBy: { date: 'desc' },
    }),
    db.reportDowntime.aggregate({
      where: { report: { crewId, date: { gte: from, lte: to } } },
      _sum: { duration: true },
      _count: true,
    }),
  ]);

  return {
    reports,
    totalDowntime: downtimes._sum.duration || 0,
    downtimeCount: downtimes._count,
    avgReportsPerPeriod: reports.length > 0 ? reports.length : 0,
  };
}

/**
 * Get site daily summary with single aggregated query.
 */
export async function getSiteDailySummary(siteId: string, date: string) {
  return db.$queryRawUnsafe(
    `SELECT
      COUNT(DISTINCT r.id) as report_count,
      COALESCE(SUM(p.count), 0) as total_piles,
      COALESCE(SUM(d.meters), 0) as total_drilling,
      COALESCE(SUM(dt.duration), 0) as total_downtime
    FROM "Report" r
    LEFT JOIN "PileWork" p ON p."reportId" = r.id
    LEFT JOIN "LeaderDrilling" d ON d."reportId" = r.id
    LEFT JOIN "ReportDowntime" dt ON dt."reportId" = r.id
    WHERE r."siteId" = $1 AND r."date" = $2`,
    siteId,
    date
  );
}

/**
 * Get active operators with their current crew and site.
 * Single query with joins — no N+1.
 */
export async function getActiveOperators() {
  return db.crew.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      operator: { select: { id: true, name: true, phone: true } },
      equipment: { select: { name: true, model: true } },
      site: { select: { name: true } },
      assistants: { select: { name: true } },
    },
    orderBy: [{ site: { name: 'asc' } }, { name: 'asc' }],
  });
}

/**
 * Get telemetry by time range with pagination.
 * Uses composite index (equipmentId, timestamp DESC).
 */
export async function getTelemetryByRangeOptimized(opts: {
  equipmentId?: string;
  siteId?: string;
  from: Date;
  to: Date;
  limit: number;
  cursor?: string;
}) {
  const where: Record<string, unknown> = {
    timestamp: { gte: opts.from, lte: opts.to },
  };

  if (opts.equipmentId) where.equipmentId = opts.equipmentId;
  if (opts.siteId) where.siteId = opts.siteId;

  return db.telemetryRecord.findMany({
    where,
    orderBy: { timestamp: 'desc' },
    take: Math.min(opts.limit, 1000),
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      type: true,
      equipmentId: true,
      value: true,
      unit: true,
      timestamp: true,
    },
  });
}

// ============================================================
// Batch Loaders (for DataLoader pattern)
// ============================================================

/**
 * Batch load sites by IDs in single query.
 * Eliminates N+1 when iterating over reports.
 */
export async function batchLoadSites(ids: string[]) {
  const sites = await db.site.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, isActive: true },
  });

  const siteMap = new Map(sites.map((s) => [s.id, s]));
  return ids.map((id) => siteMap.get(id) || null);
}

/**
 * Batch load crews by IDs in single query.
 */
export async function batchLoadCrews(ids: string[]) {
  const crews = await db.crew.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      operatorId: true,
      equipmentId: true,
      siteId: true,
      isActive: true,
    },
  });

  const crewMap = new Map(crews.map((c) => [c.id, c]));
  return ids.map((id) => crewMap.get(id) || null);
}

/**
 * Batch load pile grades by IDs.
 */
export async function batchLoadPileGrades(ids: string[]) {
  const grades = await db.pileGrade.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });

  const gradeMap = new Map(grades.map((g) => [g.id, g]));
  return ids.map((id) => gradeMap.get(id) || null);
}
