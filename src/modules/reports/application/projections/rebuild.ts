/**
 * Projection backfill — recompute denormalized read tables from source of truth.
 *
 * Used in two places:
 *   - scripts/backfill-projections.ts (one-off CLI for ops)
 *   - POST /api/admin/projections/rebuild?name=... (admin-triggered)
 *
 * Each rebuilder is idempotent: drop or upsert, then write the canonical
 * aggregate from the Report table. Safe to re-run.
 */
import { db } from '@/lib/db';
import { forEachTenant } from '@/lib/tenant-iteration';

// 'operator-performance' и 'report-stats' убраны 17.08.2026 вместе с самими
// проекциями: их никто не читал. Пересобирать нечего.
export type ProjectionName =
  | 'site-daily'
  | 'site-weekly'
  | 'report-analytics'
  | 'all';

export interface RebuildResult {
  name: ProjectionName;
  rowsWritten: number;
  durationMs: number;
}


/** Rebuild SiteDailySummary from Report aggregates per (siteId, date). */
export async function rebuildSiteDailySummary(): Promise<RebuildResult> {
  const start = Date.now();
  const written = await forEachTenant(rebuildSiteDailySummaryForTenant);
  return {
    name: 'site-daily',
    rowsWritten: written.reduce((a, b) => a + b, 0),
    durationMs: Date.now() - start,
  };
}

async function rebuildSiteDailySummaryForTenant(tenantId: string): Promise<number> {
  const reports = await db.report.findMany({
    where: { tenantId },
    select: {
      siteId: true, date: true,
      piles: { select: { count: true } },
      drillings: { select: { meters: true } },
      downtimes: { select: { duration: true } },
    },
  });

  const agg = new Map<string, {
    siteId: string; date: string;
    totalPiles: number; totalDrilling: number; totalDowntime: number; reportCount: number;
  }>();
  for (const r of reports) {
    const key = `${r.siteId}|${r.date}`;
    const cur = agg.get(key) || {
      siteId: r.siteId, date: r.date,
      totalPiles: 0, totalDrilling: 0, totalDowntime: 0, reportCount: 0,
    };
    cur.totalPiles += r.piles.reduce((a, p) => a + (p.count || 0), 0);
    cur.totalDrilling += r.drillings.reduce((a, d) => a + (d.meters || 0), 0);
    cur.totalDowntime += r.downtimes.reduce((a, d) => a + (d.duration || 0), 0);
    cur.reportCount += 1;
    agg.set(key, cur);
  }

  // У SiteDailySummary нет своей колонки организации — её граница проходит
  // через объект. Поэтому чистим не всю таблицу, а строки объектов этой
  // организации: иначе пересчёт одной стирал бы проекцию остальных.
  const siteIds = (await db.site.findMany({ where: { tenantId }, select: { id: true } }))
    .map((site) => site.id);

  // Wipe and rebuild atomically — a non-transactional wipe followed by a
  // failing insert would leave the projection empty until the next run.
  await db.$transaction(async (tx) => {
    await tx.siteDailySummary.deleteMany({ where: { siteId: { in: siteIds } } });
    await tx.siteDailySummary.createMany({ data: [...agg.values()] });
  });
  return agg.size;
}

/**
 * Rebuild SiteWeeklyTrend from SiteDailySummary, grouped by ISO Monday week.
 * Call after rebuildSiteDailySummary so the input is fresh.
 */
export async function rebuildSiteWeeklyTrend(): Promise<RebuildResult> {
  const start = Date.now();
  const written = await forEachTenant(rebuildSiteWeeklyTrendForTenant);
  return {
    name: 'site-weekly',
    rowsWritten: written.reduce((a, b) => a + b, 0),
    durationMs: Date.now() - start,
  };
}

async function rebuildSiteWeeklyTrendForTenant(tenantId: string): Promise<number> {
  // SiteWeeklyTrend.tenantId is NOT NULL on prod (schema drift: nullable in
  // schema.prisma). Creating rows without it wiped the projection nightly and
  // then crashed on the first insert — resolve it from Site, exactly like the
  // live path in projection-worker does.
  const sites = await db.site.findMany({ where: { tenantId }, select: { id: true, tenantId: true } });
  const tenantBySite = new Map(sites.map((s) => [s.id, s.tenantId]));
  const siteIds = sites.map((site) => site.id);
  const fallbackTenant = tenantId;

  const daily = await db.siteDailySummary.findMany({ where: { siteId: { in: siteIds } } });

  const mondayOf = (isoDate: string) => {
    const d = new Date(`${isoDate}T00:00:00Z`);
    const dow = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() - dow + 1);
    return d.toISOString().split('T')[0];
  };
  const sundayOf = (mondayIso: string) => {
    const d = new Date(`${mondayIso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 6);
    return d.toISOString().split('T')[0];
  };

  const weekly = new Map<string, {
    siteId: string; weekStart: string; weekEnd: string;
    totalPiles: number; totalDrilling: number; totalDowntime: number; reportCount: number;
    dailyMetrics: Array<{ date: string; piles: number; drilling: number; downtime: number; reports: number }>;
  }>();
  for (const d of daily) {
    const ws = mondayOf(d.date);
    const key = `${d.siteId}|${ws}`;
    const cur = weekly.get(key) || {
      siteId: d.siteId, weekStart: ws, weekEnd: sundayOf(ws),
      totalPiles: 0, totalDrilling: 0, totalDowntime: 0, reportCount: 0,
      dailyMetrics: [],
    };
    cur.totalPiles += d.totalPiles;
    cur.totalDrilling += d.totalDrilling;
    cur.totalDowntime += d.totalDowntime;
    cur.reportCount += d.reportCount;
    cur.dailyMetrics.push({
      date: d.date, piles: d.totalPiles, drilling: d.totalDrilling,
      downtime: d.totalDowntime, reports: d.reportCount,
    });
    weekly.set(key, cur);
  }

  const rows = [...weekly.values()].map((v) => {
    v.dailyMetrics.sort((a, b) => a.date.localeCompare(b.date));
    return {
      siteId: v.siteId,
      tenantId: tenantBySite.get(v.siteId) ?? fallbackTenant,
      weekStart: v.weekStart, weekEnd: v.weekEnd,
      totalPiles: v.totalPiles, totalDrilling: v.totalDrilling,
      totalDowntime: v.totalDowntime, reportCount: v.reportCount,
      dailyMetrics: v.dailyMetrics as never,
      pilesTrend: null, drillingTrend: null, downtimeTrend: null,
    };
  });

  // Atomic wipe+rebuild: the old delete-then-create-in-a-loop left the table
  // empty when any insert failed (which is exactly what happened on prod).
  await db.$transaction(async (tx) => {
    await tx.siteWeeklyTrend.deleteMany({ where: { tenantId } });
    await tx.siteWeeklyTrend.createMany({ data: rows });
  });
  return weekly.size;
}

/**
 * Rebuild ReportAnalytics — per-report read model used by the operator's
 * report history and the admin period filter. Mirrors the upsert logic in
 * services/reports/event-handlers.ts:handleReportForAnalytics so the same
 * source of truth (Report row + child sums) is written.
 */
export async function rebuildReportAnalytics(): Promise<RebuildResult> {
  const start = Date.now();
  const written = await forEachTenant(rebuildReportAnalyticsForTenant);
  return {
    name: 'report-analytics',
    rowsWritten: written.reduce((a, b) => a + b, 0),
    durationMs: Date.now() - start,
  };
}

async function rebuildReportAnalyticsForTenant(tenantId: string): Promise<number> {
  const reports = await db.report.findMany({
    where: { tenantId },
    select: {
      id: true, reportId: true, siteId: true, userId: true, tenantId: true, status: true, updatedAt: true,
      piles: { select: { count: true } },
      drillings: { select: { meters: true } },
      downtimes: { select: { duration: true } },
    },
  });

  let rows = 0;
  for (const r of reports) {
    if (!r.siteId || !r.userId) continue;
    const totalPiles = r.piles.reduce((s, p) => s + (p.count || 0), 0);
    const totalDrilling = r.drillings.reduce((s, d) => s + (d.meters || 0), 0);
    const totalDowntime = r.downtimes.reduce((s, d) => s + (d.duration || 0), 0);
    // ReportAnalytics.reportId stores Report.reportId (uuid), NOT Report.id
    // (cuid). The realtime handler (services/reports/event-handlers.ts
    // handleReportForAnalytics) writes the uuid — see commits 3b07426 /
    // 7f1f0e6. This rebuilder used to write the cuid, which created
    // unreachable rows alongside the real ones (every monitoring query
    // joins on r.reportId = ra.reportId). Now writes the uuid to match.
    await db.reportAnalytics.upsert({
      where: { reportId: r.reportId },
      create: {
        reportId: r.reportId,
        siteId: r.siteId,
        userId: r.userId,
        tenantId: r.tenantId || null,
        status: r.status || 'draft',
        totalPiles, totalDrilling, totalDowntime,
        lastEventAt: r.updatedAt,
      },
      update: {
        status: r.status || undefined,
        totalPiles, totalDrilling, totalDowntime,
        lastEventAt: r.updatedAt,
      },
    });
    rows++;
  }
  return rows;
}

/** Rebuild everything (daily must come before weekly — weekly reads from daily). */
export async function rebuildAll(): Promise<RebuildResult[]> {
  const analytics = await rebuildReportAnalytics();
  const daily = await rebuildSiteDailySummary();
  const weekly = await rebuildSiteWeeklyTrend();
  return [analytics, daily, weekly];
}
