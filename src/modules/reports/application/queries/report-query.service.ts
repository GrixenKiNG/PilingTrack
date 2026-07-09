/**
 * Report Query Service — CQRS Read Side
 *
 * All read operations. Uses projections (report_analytics, site_daily_summary)
 * for fast dashboard queries instead of complex joins.
 */

import { db } from '@/lib/db';
import { ServiceError } from '@/lib/service-error';
import { pileLengthMeters } from '@/lib/pile-length';
// eslint-disable-next-line no-restricted-imports -- legacy cross-layer import pending the parked services<->modules migration (CLAUDE.md); behavior-neutral
import { resolveUserScope } from '@/services/auth/authorization-service';
// eslint-disable-next-line no-restricted-imports -- legacy cross-layer import pending the parked services<->modules migration (CLAUDE.md); behavior-neutral
import { resolveAccessibleUserId } from '@/services/auth/resource-access-service';
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

  const page = await paginateQuery(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped external/library boundary
    (args) => db.report.findMany(args as any),
    { cursor: pagination?.cursor, limit: pagination?.limit ?? 25 },
    {
      where,
      include: reportDetailInclude,
      orderBy: { date: 'desc' },
    }
  );

  // hasPhotos + first thumbnail id in one batched query — the admin list used
  // to fire two GET /api/media round-trips per report (~200 requests per screen).
  // Media.entityId stores Report.reportId (business UUID), not Report.id.
  const reportIds = page.data
    .map((r) => (r as { reportId?: string }).reportId)
    .filter((id): id is string => Boolean(id));
  const mediaRows = reportIds.length
    ? await db.media.findMany({
        where: { entityType: 'report', entityId: { in: reportIds }, isDeleted: false, uploadStatus: 'completed' },
        orderBy: { createdAt: 'asc' },
        select: { id: true, entityId: true },
      })
    : [];
  const thumbByReport = new Map<string, string>();
  for (const m of mediaRows) {
    if (m.entityId && !thumbByReport.has(m.entityId)) thumbByReport.set(m.entityId, m.id);
  }

  return {
    ...page,
    data: page.data.map((r) => {
      const row = r as { reportId?: string; journalPhotoMediaId?: string | null };
      const thumbnailMediaId = (row.reportId ? thumbByReport.get(row.reportId) : undefined) ?? row.journalPhotoMediaId ?? null;
      return { ...r, hasPhotos: thumbnailMediaId != null, thumbnailMediaId };
    }),
  };
}

// ── Recent reports for the dispatcher dashboard evidence journal ──────────────
export interface RecentReportRow {
  id: string;
  reportId: string;
  date: string;
  shiftType: string;
  siteName: string;
  equipmentName: string;
  operatorName: string;
  crewName: string | null;
  status: string;
  hasPhoto: boolean;
  photoCount: number;
  edited: boolean;
  updatedAt: string;
}

export async function listRecentReportsForDashboard(
  sessionUser: { tenantId?: string | null },
  limit = 8,
): Promise<RecentReportRow[]> {
  const tenantId = sessionUser.tenantId ?? process.env.DEFAULT_TENANT_ID;
  if (!tenantId) throw new ServiceError('tenantId is required', 400); // fail-closed (IDOR guard)

  const reports = await db.report.findMany({
    where: { tenantId },
    orderBy: { updatedAt: 'desc' },
    take: limit,
    select: {
      id: true, reportId: true, date: true, shiftType: true, status: true, version: true, journalPhotoMediaId: true, updatedAt: true,
      site: { select: { name: true } },
      equipment: { select: { name: true } },
      user: { select: { name: true } },
      crew: { select: { name: true } },
    },
  });

  // Media.entityId stores Report.reportId (business UUID), not Report.id —
  // grouping by r.id matched zero rows and hasPhoto fell back to journalPhotoMediaId only.
  const ids = reports.map((r) => r.reportId);
  const counts = ids.length
    ? await db.media.groupBy({
        by: ['entityId'],
        where: { entityType: 'report', entityId: { in: ids }, isDeleted: false, uploadStatus: 'completed' },
        _count: true,
      })
    : [];
  const withMedia = new Set(
    counts.filter((c) => c.entityId != null && c._count > 0).map((c) => c.entityId as string),
  );

  return reports.map((r) => ({
    id: r.id,
    reportId: r.reportId,
    date: r.date,
    shiftType: r.shiftType,
    siteName: r.site?.name ?? '—',
    equipmentName: r.equipment?.name ?? '—',
    operatorName: r.user?.name ?? '—',
    crewName: r.crew?.name ?? null,
    status: r.status,
    hasPhoto: r.journalPhotoMediaId != null || withMedia.has(r.reportId),
    photoCount: counts.find((c) => c.entityId === r.reportId)?._count ?? (r.journalPhotoMediaId ? 1 : 0),
    edited: r.version > 1,
    updatedAt: r.updatedAt.toISOString(),
  }));
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
      piles: { select: { count: true, pileGrade: { select: { name: true, lengthMm: true } } } },
      drillings: { select: { count: true, meters: true } },
      downtimes: { select: { duration: true } },
    },
    orderBy: { date: 'desc' },
    cursor: cursor ? { id: cursor } : undefined,
    take: take + 1,
    skip: cursor ? 1 : 0,
  });

  return reports.map((report) => ({
    id: report.id,
    siteId: report.siteId,
    siteName: report.site.name,
    date: report.date,
    status: report.status,
    totalPiles: report.piles.reduce((sum: number, pile: { count: number }) => sum + pile.count, 0),
    totalPileMeters: report.piles.reduce(
      (sum: number, pile: { count: number; pileGrade: { lengthMm: number | null } }) =>
        sum + pile.count * pileLengthMeters({ gradeLengthMm: pile.pileGrade?.lengthMm }),
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
  tenantId: string;
  siteId?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
}) {
  if (!filters.tenantId) {
    throw new ServiceError('tenantId is required', 400); // fail-closed (IDOR guard)
  }

  const where: Record<string, unknown> = { tenantId: filters.tenantId };
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped external/library boundary
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped external/library boundary
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped external/library boundary
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
