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
import { projectOperatorPerformanceFull } from './projection-worker';

export type ProjectionName =
  | 'operator-performance'
  | 'site-daily'
  | 'site-weekly'
  | 'report-analytics'
  | 'report-stats'
  | 'all';

export interface RebuildResult {
  name: ProjectionName;
  rowsWritten: number;
  durationMs: number;
}

/** Rebuild OperatorPerformance from every Report's (userId, siteId, date) triple. */
export async function rebuildOperatorPerformance(): Promise<RebuildResult> {
  const start = Date.now();
  const reports = await db.report.findMany({
    select: { userId: true, siteId: true, date: true },
  });
  const triples = new Map<string, { userId: string; siteId: string; date: string }>();
  for (const r of reports) {
    triples.set(`${r.userId}|${r.siteId}|${r.date}`, r);
  }
  for (const t of triples.values()) {
    await projectOperatorPerformanceFull(t.userId, t.siteId, t.date);
  }
  return {
    name: 'operator-performance',
    rowsWritten: triples.size,
    durationMs: Date.now() - start,
  };
}

/** Rebuild SiteDailySummary from Report aggregates per (siteId, date). */
export async function rebuildSiteDailySummary(): Promise<RebuildResult> {
  const start = Date.now();
  const reports = await db.report.findMany({
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

  // Wipe and rebuild atomically — a non-transactional wipe followed by a
  // failing insert would leave the projection empty until the next run.
  await db.$transaction(async (tx) => {
    await tx.siteDailySummary.deleteMany({});
    await tx.siteDailySummary.createMany({ data: [...agg.values()] });
  });
  return { name: 'site-daily', rowsWritten: agg.size, durationMs: Date.now() - start };
}

/**
 * Rebuild SiteWeeklyTrend from SiteDailySummary, grouped by ISO Monday week.
 * Call after rebuildSiteDailySummary so the input is fresh.
 */
export async function rebuildSiteWeeklyTrend(): Promise<RebuildResult> {
  const start = Date.now();
  const daily = await db.siteDailySummary.findMany();

  // SiteWeeklyTrend.tenantId is NOT NULL on prod (schema drift: nullable in
  // schema.prisma). Creating rows without it wiped the projection nightly and
  // then crashed on the first insert — resolve it from Site, exactly like the
  // live path in projection-worker does.
  const sites = await db.site.findMany({ select: { id: true, tenantId: true } });
  const tenantBySite = new Map(sites.map((s) => [s.id, s.tenantId]));
  const fallbackTenant = process.env.DEFAULT_TENANT_ID || null;

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
    await tx.siteWeeklyTrend.deleteMany({});
    await tx.siteWeeklyTrend.createMany({ data: rows });
  });
  return { name: 'site-weekly', rowsWritten: weekly.size, durationMs: Date.now() - start };
}

/**
 * Rebuild ReportAnalytics — per-report read model used by the operator's
 * report history and the admin period filter. Mirrors the upsert logic in
 * services/reports/event-handlers.ts:handleReportForAnalytics so the same
 * source of truth (Report row + child sums) is written.
 */
export async function rebuildReportAnalytics(): Promise<RebuildResult> {
  const start = Date.now();
  const reports = await db.report.findMany({
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
  return { name: 'report-analytics', rowsWritten: rows, durationMs: Date.now() - start };
}

/**
 * Rebuild ReportStats — per-report stats with shift productivity used by
 * analytics dashboards. Mirrors projection-worker.ts:projectReportStats.
 */
export async function rebuildReportStats(): Promise<RebuildResult> {
  const start = Date.now();
  const reports = await db.report.findMany({
    include: { piles: true, drillings: true, downtimes: true },
  });

  let rows = 0;
  for (const r of reports) {
    if (!r.siteId || !r.userId) continue;

    let topReasonId: string | null = null;
    let topReasonDuration: number | null = null;
    if (r.downtimes.length > 0) {
      const byReason = new Map<string, number>();
      for (const dt of r.downtimes) byReason.set(dt.reasonId, (byReason.get(dt.reasonId) || 0) + dt.duration);
      let maxDur = 0;
      for (const [reasonId, dur] of byReason) if (dur > maxDur) { maxDur = dur; topReasonId = reasonId; topReasonDuration = dur; }
    }

    let pilesPerHour: number | null = null;
    let drillingPerHour: number | null = null;
    if (r.shiftStart && r.shiftEnd) {
      const [sh, sm] = r.shiftStart.split(':').map(Number);
      const [eh, em] = r.shiftEnd.split(':').map(Number);
      let hrs = (eh * 60 + em - sh * 60 - sm) / 60;
      if (hrs < 0) hrs += 24;
      if (hrs > 0) {
        const tp = r.piles.reduce((s, p) => s + p.count, 0);
        const td = r.drillings.reduce((s, d) => s + d.meters, 0);
        pilesPerHour = Math.round((tp / hrs) * 100) / 100;
        drillingPerHour = Math.round((td / hrs) * 100) / 100;
      }
    }

    const totalPiles = r.piles.reduce((s, p) => s + p.count, 0);
    const totalDrilling = r.drillings.reduce((s, d) => s + d.meters, 0);
    const totalDowntime = r.downtimes.reduce((s, d) => s + d.duration, 0);

    await db.reportStats.upsert({
      where: { reportId: r.reportId },
      create: {
        reportId: r.reportId,
        siteId: r.siteId, userId: r.userId, tenantId: r.tenantId || null,
        date: r.date, shiftType: r.shiftType,
        totalPiles, totalDrilling, totalDowntime,
        downtimeCount: r.downtimes.length,
        pileGradeCount: new Set(r.piles.map((p) => p.pileGradeId)).size,
        drillingCount: r.drillings.length,
        pilesPerHour, drillingPerHour,
        topDowntimeReasonId: topReasonId, topDowntimeDuration: topReasonDuration,
      },
      update: {
        totalPiles, totalDrilling, totalDowntime,
        downtimeCount: r.downtimes.length,
        pileGradeCount: new Set(r.piles.map((p) => p.pileGradeId)).size,
        drillingCount: r.drillings.length,
        pilesPerHour, drillingPerHour,
        topDowntimeReasonId: topReasonId, topDowntimeDuration: topReasonDuration,
      },
    });
    rows++;
  }
  return { name: 'report-stats', rowsWritten: rows, durationMs: Date.now() - start };
}

/** Rebuild everything (daily must come before weekly — weekly reads from daily). */
export async function rebuildAll(): Promise<RebuildResult[]> {
  const analytics = await rebuildReportAnalytics();
  const stats = await rebuildReportStats();
  const op = await rebuildOperatorPerformance();
  const daily = await rebuildSiteDailySummary();
  const weekly = await rebuildSiteWeeklyTrend();
  return [analytics, stats, op, daily, weekly];
}
