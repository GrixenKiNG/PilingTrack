/**
 * Backfill projections from existing reports.
 *
 * Use case: a projector is added or revived after reports already exist
 * (their outbox events are already marked projected=true). This walks
 * every report in the DB and replays the relevant projection logic.
 *
 * Run:  npx tsx scripts/backfill-projections.ts
 */
import 'dotenv/config';
import { db } from '../src/lib/db';

async function main() {
  const reports = await db.report.findMany({
    select: { id: true, userId: true, siteId: true, date: true },
    orderBy: { date: 'asc' },
  });
  console.log(`Found ${reports.length} reports`);

  // Collect distinct (userId, siteId, date) triples — projection key.
  const triples = new Map<string, { userId: string; siteId: string; date: string }>();
  for (const r of reports) {
    triples.set(`${r.userId}|${r.siteId}|${r.date}`, {
      userId: r.userId, siteId: r.siteId, date: r.date,
    });
  }
  console.log(`Distinct (userId, siteId, date) keys: ${triples.size}`);

  // Lazy-import the projection module so dotenv runs first.
  const { projectOperatorPerformanceFull } = await import(
    '../src/modules/reports/application/projections/projection-worker'
  ) as { projectOperatorPerformanceFull?: (u: string, s: string, d: string) => Promise<void> };

  if (!projectOperatorPerformanceFull) {
    throw new Error('projectOperatorPerformanceFull is not exported from projection-worker.ts');
  }

  let i = 0;
  for (const t of triples.values()) {
    i += 1;
    process.stdout.write(`\r[${i}/${triples.size}] ${t.userId.slice(0, 6)}…/${t.siteId.slice(0, 6)}…/${t.date}     `);
    await projectOperatorPerformanceFull(t.userId, t.siteId, t.date);
  }
  console.log('\nOperatorPerformance done.');

  const opCount = await db.operatorPerformance.count();
  console.log(`OperatorPerformance: ${opCount} rows`);

  // ---------- SiteDailySummary ----------
  // The runtime handler builds this with `new Date()` and `siteId || ''` —
  // useless for backfill. Wipe and rebuild from Report directly.
  await db.siteDailySummary.deleteMany({});
  const fullReports = await db.report.findMany({
    select: {
      siteId: true, date: true,
      piles: { select: { count: true } },
      drillings: { select: { meters: true } },
      downtimes: { select: { duration: true } },
    },
  });
  const dayKey = (s: string, d: string) => `${s}|${d}`;
  const dailyAgg = new Map<string, {
    siteId: string; date: string;
    totalPiles: number; totalDrilling: number; totalDowntime: number; reportCount: number;
  }>();
  for (const r of fullReports) {
    const k = dayKey(r.siteId, r.date);
    const cur = dailyAgg.get(k) || {
      siteId: r.siteId, date: r.date,
      totalPiles: 0, totalDrilling: 0, totalDowntime: 0, reportCount: 0,
    };
    cur.totalPiles += r.piles.reduce((a, p) => a + (p.count || 0), 0);
    cur.totalDrilling += r.drillings.reduce((a, d) => a + (d.meters || 0), 0);
    cur.totalDowntime += r.downtimes.reduce((a, d) => a + (d.duration || 0), 0);
    cur.reportCount += 1;
    dailyAgg.set(k, cur);
  }
  for (const v of dailyAgg.values()) {
    await db.siteDailySummary.create({ data: v });
  }
  console.log(`SiteDailySummary: ${dailyAgg.size} rows`);

  // ---------- SiteWeeklyTrend ----------
  // Group daily summaries by (siteId, ISO weekStart Monday).
  const weekKey = (s: string, w: string) => `${s}|${w}`;
  const mondayOf = (isoDate: string) => {
    const d = new Date(`${isoDate}T00:00:00Z`);
    const dow = d.getUTCDay() || 7; // 1..7 (Mon..Sun)
    d.setUTCDate(d.getUTCDate() - dow + 1);
    return d.toISOString().split('T')[0];
  };
  const sundayOf = (mondayIso: string) => {
    const d = new Date(`${mondayIso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 6);
    return d.toISOString().split('T')[0];
  };

  await db.siteWeeklyTrend.deleteMany({});
  const weekAgg = new Map<string, {
    siteId: string; weekStart: string; weekEnd: string;
    totalPiles: number; totalDrilling: number; totalDowntime: number; reportCount: number;
    dailyMetrics: Array<{ date: string; piles: number; drilling: number; downtime: number; reports: number }>;
  }>();
  for (const v of dailyAgg.values()) {
    const ws = mondayOf(v.date);
    const k = weekKey(v.siteId, ws);
    const cur = weekAgg.get(k) || {
      siteId: v.siteId, weekStart: ws, weekEnd: sundayOf(ws),
      totalPiles: 0, totalDrilling: 0, totalDowntime: 0, reportCount: 0,
      dailyMetrics: [],
    };
    cur.totalPiles += v.totalPiles;
    cur.totalDrilling += v.totalDrilling;
    cur.totalDowntime += v.totalDowntime;
    cur.reportCount += v.reportCount;
    cur.dailyMetrics.push({
      date: v.date, piles: v.totalPiles, drilling: v.totalDrilling,
      downtime: v.totalDowntime, reports: v.reportCount,
    });
    weekAgg.set(k, cur);
  }
  for (const v of weekAgg.values()) {
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
  console.log(`SiteWeeklyTrend: ${weekAgg.size} rows`);

  process.exit(0);
}

main().catch((e) => { console.error('\nERROR', e); process.exit(1); });
