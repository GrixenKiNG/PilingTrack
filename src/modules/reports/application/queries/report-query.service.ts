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
  if (sessionUser.role !== 'ADMIN' && sessionUser.role !== 'DISPATCHER') {
    if (!sessionUser.tenantId) throw new ServiceError('Пользователь не привязан к организации', 403);
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

/**
 * Итоги по ВСЕМУ отбору журнала, а не по загруженной странице: журнал
 * листается по 100, и плитки над ним показывали сумму первой сотни (955 свай
 * при 2832 в базе). Считаются только сданные отчёты — как «Аналитика» и
 * дашборд; черновик в итоги не входит ни на одном экране.
 */
async function sumSubmittedReports(where: Record<string, unknown>) {
  const reportWhere = { ...where, status: 'submitted' };
  const [reports, pilesByGrade, drilling, downtime] = await Promise.all([
    db.report.count({ where: reportWhere }),
    db.pileWork.groupBy({ by: ['pileGradeId'], where: { report: reportWhere }, _sum: { count: true } }),
    db.leaderDrilling.aggregate({ where: { report: reportWhere }, _sum: { count: true, meters: true } }),
    db.reportDowntime.aggregate({ where: { report: reportWhere }, _sum: { duration: true } }),
  ]);
  const grades = pilesByGrade.length
    ? await db.pileGrade.findMany({
        where: { id: { in: pilesByGrade.map((row) => row.pileGradeId) } },
        select: { id: true, lengthMm: true },
      })
    : [];
  const lengthById = new Map(grades.map((g) => [g.id, g.lengthMm]));
  let piles = 0;
  let pileMeters = 0;
  for (const row of pilesByGrade) {
    const count = row._sum.count ?? 0;
    piles += count;
    pileMeters += count * pileLengthMeters({ gradeLengthMm: lengthById.get(row.pileGradeId) });
  }
  return {
    reports,
    piles,
    pileMeters,
    drillingCount: drilling._sum.count ?? 0,
    drillingMeters: drilling._sum.meters ?? 0,
    downtimeHours: downtime._sum.duration ?? 0,
  };
}

export async function listReportsForReview(
  sessionUser: { id: string; role: string; tenantId?: string | null },
  siteId?: string | null,
  pagination?: { cursor?: string; limit?: number },
  userId?: string | null
) {
  const { paginateQuery } = await import('@/lib/pagination');

  // Tenant isolation: non-privileged users can only access their tenant's reports.
  // Без организации — отказ: раньше фильтр молча не ставился, и оператор без
  // организации получил бы отчёты всех организаций (аудит R26-2).
  const where: Record<string, unknown> = {};
  if (sessionUser.role !== 'ADMIN' && sessionUser.role !== 'DISPATCHER') {
    if (!sessionUser.tenantId) throw new ServiceError('Пользователь не привязан к организации', 403);
    where.tenantId = sessionUser.tenantId;
  }
  if (siteId) {
    where.siteId = siteId;
  }
  if (userId) {
    where.userId = userId;
  }

  // Сколько всего отчётов под этим отбором — тем же условием, что и страница.
  // Экран считает итоги по загруженным строкам, и без этого числа он выдавал
  // сумму первой сотни за сумму всего среза: 821 свая вместо 2320. Считаем
  // тут, а не вторым условием на экране: расхождение условий дало бы «100 из
  // 90» и веру пользователя в цифру, которой нет.
  const total = await db.report.count({ where });
  const sums = await sumSubmittedReports(where);

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
    total,
    sums,
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
  // Организация — только из сессии. Подстановка DEFAULT_TENANT_ID означала бы,
  // что пользователь без организации видит отчёты организации по умолчанию:
  // ровно тот шаблон, которым в этом продукте уже случался IDOR (31.05.2026).
  // Пустая организация — это отказ, а не повод подставить чужую.
  const tenantId = sessionUser.tenantId;
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

// Выгрузки вынесены в ./report-export.service (решение владельца 26.09.2026).
// Реэкспорт держит прежний путь импорта для всех вызывающих.
export { exportReportsCsv, exportReportsXlsx } from './report-export.service';
export type { ReportExportFilters } from './report-export.service';

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
