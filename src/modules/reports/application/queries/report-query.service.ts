/**
 * Report Query Service — CQRS Read Side
 *
 * All read operations. Uses projections (report_analytics, site_daily_summary)
 * for fast dashboard queries instead of complex joins.
 */

import { db } from '@/lib/db';
import { ServiceError } from '@/services/service-error';
import { resolveUserScope } from '@/services/auth/authorization-service';
import { resolveAccessibleUserId } from '@/services/auth/resource-access-service';
import { calculatePeriodSummary } from '../commands';
import type { CursorPaginationResult } from '@/lib/pagination-cursor';

export const reportDetailInclude = {
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
  piles: { include: { pileGrade: true } },
  drillings: { include: { type: true } },
  downtimes: { include: { reason: true } },
} as const;

function resolveReportUserId(
  sessionUser: { id: string; role: string },
  requestedUserId?: string | null
) {
  return resolveAccessibleUserId(sessionUser, requestedUserId, 'reports.read_cross_user');
}

export async function getEditableReport(
  sessionUser: { id: string; role: string; tenantId?: string | null },
  requestedUserId: string | null,
  siteId: string | null,
  date: string | null
) {
  if (!siteId || !date) {
    throw new ServiceError('siteId, date required', 400);
  }

  const userId = resolveReportUserId(sessionUser, requestedUserId);

  // Tenant isolation: non-privileged users can only access their tenant's reports
  const where: { userId: string; siteId: string; date: string; tenantId?: string | null } = {
    userId,
    siteId,
    date,
  };
  if (sessionUser.role !== 'ADMIN' && sessionUser.role !== 'DISPATCHER' && sessionUser.tenantId) {
    where.tenantId = sessionUser.tenantId;
  }

  return db.report.findFirst({
    where,
    include: reportDetailInclude,
  });
}

export async function getReportsByPeriod(
  dateFrom: string | null,
  dateTo: string | null,
  siteId?: string | null,
  tenantId?: string | null,
  userId?: string | null
) {
  if (!dateFrom || !dateTo) {
    throw new ServiceError('dateFrom and dateTo are required', 400);
  }

  // Use raw SQL for performance — 4-10x faster than Prisma includes
  const { getReportsByPeriodRaw } = await import('@/core/infrastructure/raw-queries');
  return getReportsByPeriodRaw(tenantId || '', dateFrom, dateTo, siteId, userId);
}

export async function listReportsForReview(
  sessionUser: { id: string; role: string; tenantId?: string | null },
  siteId?: string | null,
  pagination?: { cursor?: string; limit?: number },
  userId?: string | null
) {
  const { paginateQuery } = await import('@/lib/pagination');

  // Tenant isolation: non-privileged users can only access their tenant's reports
  const where: Record<string, unknown> = {};
  if (sessionUser.role !== 'ADMIN' && sessionUser.role !== 'DISPATCHER' && sessionUser.tenantId) {
    where.tenantId = sessionUser.tenantId;
  }
  if (siteId) {
    where.siteId = siteId;
  }
  if (userId) {
    where.userId = userId;
  }

  return paginateQuery(
    (args) => db.report.findMany(args as any),
    { cursor: pagination?.cursor, limit: pagination?.limit ?? 25 },
    {
      where,
      include: reportDetailInclude,
      orderBy: { date: 'desc' },
    }
  );
}

export async function listReportsForUserScope(
  sessionUser: { id: string; role: string; tenantId?: string | null },
  requestedUserId?: string | null,
  pagination?: CursorPaginationResult
) {
  const userId = resolveUserScope(sessionUser, requestedUserId, 'reports.read_cross_user');

  // Tenant isolation: non-privileged users can only access their tenant's reports
  const where: { userId: string; tenantId?: string | null } = { userId };
  if (sessionUser.role !== 'ADMIN' && sessionUser.role !== 'DISPATCHER' && sessionUser.tenantId) {
    where.tenantId = sessionUser.tenantId;
  }

  const take = pagination?.take ?? 50;
  const cursor = pagination?.cursor ?? undefined;

  const reports = await db.report.findMany({
    where,
    include: {
      site: { select: { name: true } },
      piles: { select: { count: true, pileGrade: { select: { name: true } } } },
      drillings: { select: { count: true, meters: true } },
      downtimes: { select: { duration: true } },
    },
    orderBy: { date: 'desc' },
    cursor: cursor ? { id: cursor } : undefined,
    take: take + 1,
    skip: cursor ? 1 : 0,
  });

  const pileLengthFromName = (name: string) => {
    const m = name.match(/\d{3}/);
    return m ? Number(m[0]) / 10 : 0;
  };

  return reports.map((report) => ({
    id: report.id,
    siteId: report.siteId,
    siteName: report.site.name,
    date: report.date,
    status: report.status,
    totalPiles: report.piles.reduce((sum: number, pile: { count: number }) => sum + pile.count, 0),
    totalPileMeters: report.piles.reduce(
      (sum: number, pile: { count: number; pileGrade: { name: string } }) =>
        sum + pile.count * pileLengthFromName(pile.pileGrade?.name || ''),
      0,
    ),
    totalDrillingCount: report.drillings.reduce(
      (sum: number, d: { count: number | null }) => sum + (d.count || 1),
      0,
    ),
    totalDrilling: report.drillings.reduce((sum: number, d: { meters: number }) => sum + d.meters, 0),
    totalDowntime: report.downtimes.reduce((sum: number, d: { duration: number }) => sum + d.duration, 0),
    createdAt: report.createdAt,
  }));
}

export async function exportReportsCsv(filters: {
  siteId?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
}) {
  const where: Record<string, unknown> = {};
  if (filters.siteId) where.siteId = filters.siteId;
  if (filters.dateFrom || filters.dateTo) {
    where.date = {};
    if (filters.dateFrom) (where.date as Record<string, unknown>).gte = filters.dateFrom;
    if (filters.dateTo) (where.date as Record<string, unknown>).lte = filters.dateTo;
  }

  const reports = await db.report.findMany({
    where,
    include: {
      user: { select: { name: true } },
      crew: { select: { name: true, equipment: { select: { name: true } } } },
      site: { select: { name: true } },
      piles: { include: { pileGrade: true } },
      drillings: { include: { type: true } },
      downtimes: { include: { reason: true } },
    },
    orderBy: { date: 'desc' },
  });

  const BOM = '\uFEFF';
  const header =
    'ID отчёта;Дата;Смена;Объект;Оператор;Экипаж;Установка;Марка сваи;Кол-во свай;Тип бурения;Метры бурения;Причина простоя;Часы простоя;Комментарий';

  const rows = reports.flatMap((report) => {
    const base = {
      reportId: report.reportId,
      date: report.date,
      shift: report.shiftType === 'NIGHT' ? 'Ночная' : 'Дневная',
      site: report.site.name,
      operator: report.user.name,
      crew: report.crew?.name || '',
      equipment: report.crew?.equipment?.name || '',
    };

    const pileRows = report.piles.map((pile: any) => ({
      ...base,
      pileGrade: pile.pileGrade.name,
      pileCount: String(pile.count),
      drillType: '',
      drillMeters: '',
      dtReason: '',
      dtHours: '',
      dtComment: '',
    }));

    const drillingRows = report.drillings.map((drilling: any) => ({
      ...base,
      pileGrade: '',
      pileCount: '',
      drillType: drilling.type.name,
      drillMeters: String(drilling.meters),
      dtReason: '',
      dtHours: '',
      dtComment: '',
    }));

    const downtimeRows = report.downtimes.map((downtime: any) => ({
      ...base,
      pileGrade: '',
      pileCount: '',
      drillType: '',
      drillMeters: '',
      dtReason: downtime.reason.name,
      dtHours: String(downtime.duration),
      dtComment: downtime.comment || '',
    }));

    if (pileRows.length === 0 && drillingRows.length === 0 && downtimeRows.length === 0) {
      return [
        {
          ...base,
          pileGrade: '',
          pileCount: '',
          drillType: '',
          drillMeters: '',
          dtReason: '',
          dtHours: '',
          dtComment: '',
        },
      ];
    }

    return [...pileRows, ...drillingRows, ...downtimeRows];
  });

  const csvLines = rows.map((row: Record<string, string>) =>
    Object.values(row)
      .map((value: string) => `"${value.replace(/"/g, '""')}"`)
      .join(';')
  );

  return BOM + header + '\n' + csvLines.join('\n');
}

/**
 * Dashboard query using CQRS projection (O(1) instead of O(n) joins).
 */
export async function getDashboardStats(siteId: string, date: string) {
  const summary = await db.siteDailySummary.findUnique({
    where: { siteId_date: { siteId, date } },
  });

  return summary || {
    siteId,
    date,
    totalPiles: 0,
    totalDrilling: 0,
    totalDowntime: 0,
    reportCount: 0,
  };
}
