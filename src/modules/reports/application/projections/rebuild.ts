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

export type ProjectionName = 'operator-performance' | 'site-daily' | 'site-weekly' | 'all';

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

  // Wipe and rebuild — simpler than diffing, and the table is small.
  await db.siteDailySummary.deleteMany({});
  for (const v of agg.values()) {
    await db.siteDailySummary.create({ data: v });
  }
  return { name: 'site-daily', rowsWritten: agg.size, durationMs: Date.now() - start };
}

/**
 * Rebuild SiteWeeklyTrend from SiteDailySummary, grouped by ISO Monday week.
 * Call after rebuildSiteDailySummary so the input is fresh.
 */
export async function rebuildSiteWeeklyTrend(): Promise<RebuildResult> {
  const start = Date.now();
  const daily = await db.siteDailySummary.findMany();

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

  await db.siteWeeklyTrend.deleteMany({});
  for (const v of weekly.values()) {
    v.dailyMetrics.sort((a, b) => a.date.localeCompare(b.date));
    await db.siteWeeklyTrend.create({
      data: {
        siteId: v.siteId, weekStart: v.weekStart, weekEnd: v.weekEnd,
        totalPiles: v.totalPiles, totalDrilling: v.totalDrilling,
        totalDowntime: v.totalDowntime, reportCount: v.reportCount,
        dailyMetrics: v.dailyMetrics as never,
        pilesTrend: null, drillingTrend: null, downtimeTrend: null,
      },
    });
  }
  return { name: 'site-weekly', rowsWritten: weekly.size, durationMs: Date.now() - start };
}

/** Rebuild everything (daily must come before weekly — weekly reads from daily). */
export async function rebuildAll(): Promise<RebuildResult[]> {
  const op = await rebuildOperatorPerformance();
  const daily = await rebuildSiteDailySummary();
  const weekly = await rebuildSiteWeeklyTrend();
  return [op, daily, weekly];
}
