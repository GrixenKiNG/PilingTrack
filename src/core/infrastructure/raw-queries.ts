/**
 * Raw SQL Queries — Optimized Hot Paths
 *
 * Prisma создаёт overhead для сложных запросов с множеством include.
 * Эти raw-запросы используют прямой SQL через db.$queryRaw (безопасно от инъекций).
 *
 * Benchmark-цели:
 * - getReportsByPeriod: < 50ms (vs ~200ms Prisma include)
 * - upsertReport: < 10ms (vs ~50ms find-then-update)
 */

import { db } from '@/lib/db';
import { ServiceError } from '@/lib/service-error';
import { Prisma } from '@/generated/postgres-client';
import { logger } from '@/lib/logger';

/**
 * Потолок выборки периода.
 *
 * Запрос читает до LIMIT+1 строк, чтобы отличить «ровно потолок» от «больше
 * потолка»: тихий срез раньше давал неполные итоги на экране периода и в PDF
 * (CSV/Excel лимита не имеют), и подрядчик не мог сойтись в цифрах.
 */
export const PERIOD_REPORTS_LIMIT = 2000;

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
  piles: Array<{ id: string; count: number; pileGradeId: string; pileGrade?: { name: string; lengthMm?: number | null } }> | null;
  drillings: Array<{ id: string; count: number; metersPerUnit: number; meters: number; typeId: string; type?: { name: string } }> | null;
  downtimes: Array<{ id: string; duration: number; reasonId: string; comment: string | null }> | null;
}

// ============================================================
// Reports — Period Query (с агрегацией дочерних записей)
// ============================================================

export async function getReportsByPeriodRaw(
  tenantId: string | null,
  dateFrom: string,
  dateTo: string,
  siteId?: string | null,
  userId?: string | null
) {
  const start = Date.now();

  const where: Record<string, unknown> = {
    date: { gte: dateFrom, lte: dateTo },
  };
  // Fail closed (CLAUDE.md): пустая организация — отказ, а не `tenantId IS NULL`,
  // который отдавал строки без организации вместо ошибки (аудит R26-1).
  if (!tenantId || tenantId.trim().length === 0) {
    throw new ServiceError('Не определена организация пользователя', 403);
  }
  where.tenantId = tenantId;
  if (siteId) where.siteId = siteId;
  if (userId) where.userId = userId;

  const rows = await db.report.findMany({
    where,
    orderBy: { date: 'desc' },
    take: PERIOD_REPORTS_LIMIT + 1,
    include: {
      user: { select: { id: true, name: true } },
      site: { select: { id: true, name: true } },
      equipment: { select: { id: true, name: true } },
      crew: {
        select: {
          name: true,
          equipment: { select: { name: true } },
          assistants: { select: { name: true } },
        },
      },
      piles: { select: { id: true, count: true, pileGradeId: true, pileGrade: { select: { name: true, lengthMm: true } } } },
      drillings: { select: { id: true, count: true, metersPerUnit: true, meters: true, typeId: true, type: { select: { name: true } } } },
      downtimes: { select: { id: true, duration: true, reasonId: true, comment: true, reason: { select: { name: true } } } },
    },
  });

  const reports = rows as unknown as RawReportRow[];

  // Больше потолка — отдаём явную ошибку вместо молча срезанного набора:
  // суммы периода иначе оказываются меньше, чем в CSV/Excel без лимита.
  if (reports.length > PERIOD_REPORTS_LIMIT) {
    throw new ServiceError(
      'За выбранный период больше 2000 отчётов — сузьте период или выберите объект',
      422
    );
  }

  const elapsed = Date.now() - start;
  if (elapsed > 100) {
    logger.warn('RawQuery: getReportsByPeriod slow', { elapsedMs: elapsed });
  }

  return reports;
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
  tenantId: string,
  siteId?: string | null
): Promise<CrewWithDetails[]> {
  const start = Date.now();

  // Fail closed (CLAUDE.md): у «Crew» нет своей колонки tenantId, он наследуется
  // от объекта. Пустая организация — отказ, а не полный список активных бригад
  // всех организаций с e-mail машинистов (аудит R65 #2, тот же случай, что
  // bulkDeleteReportsRaw в 398d1d50).
  if (typeof tenantId !== 'string' || tenantId.trim().length === 0) {
    throw new ServiceError('Не определена организация пользователя', 403);
  }

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
      AND s."tenantId" = ${tenantId}
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped external/library boundary
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

