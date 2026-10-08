/**
 * Raw SQL Queries — Optimized Hot Paths
 *
 * Prisma создаёт overhead для сложных запросов с множеством include.
 * Эти raw-запросы используют прямой SQL через db.$queryRaw (безопасно от инъекций).
 *
 * Benchmark-цели:
 * - getReportsByPeriod: < 50ms (vs ~200ms Prisma include)
 */

import { db } from '@/lib/db';
import { ServiceError } from '@/lib/service-error';
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

