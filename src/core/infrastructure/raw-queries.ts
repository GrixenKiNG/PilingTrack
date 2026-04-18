/**
 * Raw SQL Queries — Optimized Hot Paths
 *
 * Prisma создаёт overhead для сложных запросов с множеством include.
 * Эти raw-запросы используют прямой SQL через db.$queryRaw (безопасно от инъекций).
 *
 * Benchmark-цели:
 * - getReportsByPeriod: < 50ms (vs ~200ms Prisma include)
 * - getSiteDailySummary: < 30ms (vs ~150ms Prisma aggregation)
 * - upsertReport: < 10ms (vs ~50ms find-then-update)
 */

import { db } from '@/lib/db';
import { Prisma } from '@/generated/postgres-client';
import { logger } from '@/lib/logger';

// ============================================================
// DTOs for raw SQL results (not Prisma models — SQL returns different shape)
// ============================================================

export interface RawReportRow {
  id: string;
  reportId: string;
  userId: string;
  crewId: string | null;
  equipmentId: string | null;
  siteId: string;
  date: string;
  shiftType: string;
  shiftStart: string | null;
  shiftEnd: string | null;
  status: string;
  version: number;
  tenantId: string | null;
  createdAt: Date;
  updatedAt: Date;
  crew: { name?: string } | null;
  equipment: { name?: string } | null;
  piles: Array<{ id: string; count: number; pileGradeId: string }> | null;
  drillings: Array<{ id: string; meters: number; typeId: string }> | null;
  downtimes: Array<{ id: string; duration: number; reasonId: string; comment: string | null }> | null;
}

// ============================================================
// Reports — Period Query (с агрегацией дочерних записей)
// ============================================================

export async function getReportsByPeriodRaw(
  tenantId: string,
  dateFrom: string,
  dateTo: string,
  siteId?: string | null
) {
  const start = Date.now();

  const where: Record<string, unknown> = {
    tenantId: tenantId || null,
    date: { gte: dateFrom, lte: dateTo },
  };
  if (siteId) where.siteId = siteId;

  const rows = await db.report.findMany({
    where,
    orderBy: { date: 'desc' },
    take: 500,
    include: {
      piles: { select: { id: true, count: true, pileGradeId: true } },
      drillings: { select: { id: true, meters: true, typeId: true } },
      downtimes: { select: { id: true, duration: true, reasonId: true, comment: true } },
    },
  });

  const reports = rows as unknown as RawReportRow[];

  const elapsed = Date.now() - start;
  if (elapsed > 100) {
    logger.warn('RawQuery: getReportsByPeriod slow', { elapsedMs: elapsed });
  }

  return reports;
}

// ============================================================
// Site Daily Summary — агрегация за период
// ============================================================

export interface DailySummary {
  siteId: string;
  date: string;
  reportCount: number;
  totalPiles: number;
  totalDrilling: number;
  totalDowntime: number;
}

export async function getSiteDailySummaryRaw(
  siteId: string,
  dateFrom: string,
  dateTo: string
): Promise<DailySummary[]> {
  const start = Date.now();

  const summary = await db.$queryRaw<DailySummary[]>`
    SELECT
      r."siteId" as "siteId",
      r."date" as "date",
      COUNT(DISTINCT r.id)::int as "reportCount",
      COALESCE(SUM(piles_agg.total_count), 0)::int as "totalPiles",
      COALESCE(SUM(drillings_agg.total_meters), 0)::float as "totalDrilling",
      COALESCE(SUM(downtimes_agg.total_duration), 0)::float as "totalDowntime"
    FROM "Report" r
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(pw.count), 0) as total_count
      FROM "PileWork" pw WHERE pw."reportId" = r.id
    ) piles_agg ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(ld.meters), 0) as total_meters
      FROM "LeaderDrilling" ld WHERE ld."reportId" = r.id
    ) drillings_agg ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(rd.duration), 0) as total_duration
      FROM "ReportDowntime" rd WHERE rd."reportId" = r.id
    ) downtimes_agg ON true
    WHERE r."siteId" = ${siteId}
      AND r."date" >= ${dateFrom}
      AND r."date" <= ${dateTo}
    GROUP BY r."siteId", r."date"
    ORDER BY r."date" DESC
  `;

  const elapsed = Date.now() - start;
  if (elapsed > 50) {
    logger.warn('RawQuery: getSiteDailySummary slow', { elapsedMs: elapsed });
  }

  return summary;
}

// ============================================================
// Crews With Details — одним запросом
// ============================================================

export interface CrewWithDetails {
  id: string;
  name: string;
  operatorId: string;
  operatorName: string | null;
  operatorEmail: string | null;
  equipmentId: string;
  equipmentName: string | null;
  equipmentModel: string | null;
  siteId: string;
  siteName: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export async function getCrewsWithDetailsRaw(
  siteId?: string | null
): Promise<CrewWithDetails[]> {
  const start = Date.now();

  const crews = await db.$queryRaw<CrewWithDetails[]>`
    SELECT c.id, c.name, c."operatorId", c."equipmentId", c."siteId",
           c."isActive" as "isActive", c."createdAt", c."updatedAt",
           u.name as "operatorName", u.email as "operatorEmail",
           e.name as "equipmentName", e.model as "equipmentModel",
           s.name as "siteName"
    FROM "Crew" c
    LEFT JOIN "User" u ON c."operatorId" = u.id
    LEFT JOIN "Equipment" e ON c."equipmentId" = e.id
    LEFT JOIN "Site" s ON c."siteId" = s.id
    WHERE c."isActive" = true
      ${siteId ? Prisma.sql`AND c."siteId" = ${siteId}` : Prisma.sql``}
    ORDER BY c."createdAt" DESC
  `;

  const elapsed = Date.now() - start;
  if (elapsed > 50) {
    logger.warn('RawQuery: getCrewsWithDetails slow', { elapsedMs: elapsed });
  }

  return crews;
}

// ============================================================
// Atomic Upsert Report — один запрос вместо find-then-update
// ============================================================

export async function upsertReportRaw(params: {
  id: string;
  tenantId: string;
  userId: string;
  siteId: string;
  date: string;
  status: string;
  shiftType?: string;
  shiftStart?: string | null;
  shiftEnd?: string | null;
  equipmentId?: string | null;
}): Promise<any> {
  const start = Date.now();

  const { id, tenantId, userId, siteId, date, status, shiftType, shiftStart, shiftEnd, equipmentId } = params;

  const report = await db.$queryRaw<Array<Record<string, unknown>>>`
    INSERT INTO "Report" (
      id, "tenantId", "userId", "siteId", "date", "status",
      "shiftType", "shiftStart", "shiftEnd", "equipmentId",
      "version", "updatedAt", "createdAt"
    )
    VALUES (
      ${id}, ${tenantId}, ${userId}, ${siteId}, ${date}, ${status},
      ${shiftType || 'day'}, ${shiftStart}, ${shiftEnd}, ${equipmentId || null},
      1, NOW(), NOW()
    )
    ON CONFLICT (id) DO UPDATE SET
      "status" = EXCLUDED."status",
      "shiftType" = EXCLUDED."shiftType",
      "shiftStart" = EXCLUDED."shiftStart",
      "shiftEnd" = EXCLUDED."shiftEnd",
      "equipmentId" = EXCLUDED."equipmentId",
      "version" = "Report"."version" + 1,
      "updatedAt" = NOW()
    RETURNING *
  `;

  const elapsed = Date.now() - start;
  if (elapsed > 20) {
    logger.warn('RawQuery: upsertReport slow', { elapsedMs: elapsed });
  }

  return report[0];
}

// ============================================================
// Increment Counters — быстрое обновление статистики
// ============================================================

export async function incrementReportCountersRaw(
  reportId: string,
  pileDelta: number,
  drillingDelta: number,
  downtimeDelta: number
): Promise<void> {
  const start = Date.now();

  await db.$executeRaw`
    UPDATE "ReportStats" SET
      "totalPiles" = "totalPiles" + ${pileDelta},
      "totalDrilling" = "totalDrilling" + ${drillingDelta},
      "totalDowntime" = "totalDowntime" + ${downtimeDelta},
      "lastEventAt" = NOW()
    WHERE "reportId" = ${reportId}
  `;

  const elapsed = Date.now() - start;
  if (elapsed > 10) {
    logger.warn('RawQuery: incrementCounters slow', { elapsedMs: elapsed });
  }
}

// ============================================================
// Bulk Delete Reports — удаление с каскадом
// ============================================================

export async function bulkDeleteReportsRaw(reportIds: string[]): Promise<number> {
  if (reportIds.length === 0) return 0;

  const start = Date.now();

  const ids = Prisma.join(reportIds);

  const result = await db.$executeRaw`
    WITH deleted_pilework AS (
      DELETE FROM "PileWork" WHERE "reportId" = ANY(ARRAY[${ids}])
    ),
    deleted_drillings AS (
      DELETE FROM "LeaderDrilling" WHERE "reportId" = ANY(ARRAY[${ids}])
    ),
    deleted_downtimes AS (
      DELETE FROM "ReportDowntime" WHERE "reportId" = ANY(ARRAY[${ids}])
    )
    DELETE FROM "Report" WHERE id = ANY(ARRAY[${ids}])
  `;

  const elapsed = Date.now() - start;
  if (elapsed > 100) {
    logger.warn('RawQuery: bulkDeleteReports slow', { elapsedMs: elapsed, count: reportIds.length });
  }

  return result as number;
}
