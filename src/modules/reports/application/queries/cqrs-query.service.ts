/**
 * CQRS Read Model Query Services
 *
 * All dashboard/analytics queries hit denormalized read models (O(1)),
 * NOT normalized write tables (O(n) joins).
 */

import { db } from '@/lib/db';

// ============================================================
// Report Stats Queries
// ============================================================

export async function getReportStats(reportId: string) {
  return db.reportStats.findUnique({
    where: { reportId },
  });
}

export async function getSiteDailyStats(siteId: string, dateFrom: string, dateTo: string) {
  return db.siteDailySummary.findMany({
    where: { siteId, date: { gte: dateFrom, lte: dateTo } },
    orderBy: { date: 'asc' },
  });
}

export async function getSiteDashboard(siteId: string, date: string) {
  const [summary, stats, downtimeByReason] = await Promise.all([
    db.siteDailySummary.findUnique({
      where: { siteId_date: { siteId, date } },
    }),
    db.reportStats.findMany({
      where: { siteId, date },
      orderBy: { createdAt: 'desc' },
    }),
    db.downtimeSummary.findMany({
      where: { siteId, date },
      orderBy: { totalDuration: 'desc' },
    }),
  ]);

  return {
    summary: summary || {
      siteId, date, totalPiles: 0, totalDrilling: 0,
      totalDowntime: 0, reportCount: 0,
    },
    reports: stats,
    downtimeByReason: downtimeByReason,
  };
}

// ============================================================
// Operator Performance Queries
// ============================================================

export async function getOperatorPerformance(
  userId: string,
  dateFrom: string,
  dateTo: string
) {
  return db.operatorPerformance.findMany({
    where: {
      userId,
      date: { gte: dateFrom, lte: dateTo },
    },
    orderBy: { date: 'desc' },
  });
}

export async function getSiteOperatorPerformance(
  siteId: string,
  date: string
) {
  return db.operatorPerformance.findMany({
    where: { siteId, date },
    orderBy: { totalPiles: 'desc' },
  });
}

export async function getOperatorLeaderboard(
  date: string,
  siteId?: string | null,
  limit = 10
) {
  const where: Record<string, unknown> = { date };
  if (siteId) where.siteId = siteId;

  const performers = await db.operatorPerformance.findMany({
    where,
    orderBy: { totalPiles: 'desc' },
    take: limit,
  });

  return performers.map((p, i) => ({
    rank: i + 1,
    userId: p.userId,
    userName: p.userName,
    siteName: p.siteName,
    totalPiles: p.totalPiles,
    totalDrilling: p.totalDrilling,
    downtimeRatio: p.downtimeRatio,
    reportCount: p.reportCount,
  }));
}

// ============================================================
// Downtime Summary Queries
// ============================================================

export async function getDowntimeSummary(siteId: string, date: string) {
  return db.downtimeSummary.findMany({
    where: { siteId, date },
    orderBy: { totalDuration: 'desc' },
  });
}

export async function getDowntimeTrend(
  siteId: string,
  dateFrom: string,
  dateTo: string
) {
  const summaries = await db.downtimeSummary.groupBy({
    by: ['date'],
    where: { siteId, date: { gte: dateFrom, lte: dateTo } },
    _sum: { totalDuration: true },
    orderBy: { date: 'asc' },
  });

  return summaries.map(s => ({
    date: s.date,
    totalDowntime: s._sum.totalDuration || 0,
  }));
}

export async function getTopDowntimeReasons(
  siteId: string,
  dateFrom: string,
  dateTo: string,
  limit = 5
) {
  const reasons = await db.downtimeSummary.groupBy({
    by: ['reasonId', 'reasonName'],
    where: { siteId, date: { gte: dateFrom, lte: dateTo } },
    _sum: { totalDuration: true, occurrenceCount: true, affectedReports: true },
    orderBy: { _sum: { totalDuration: 'desc' } },
    take: limit,
  });

  return reasons.map(r => ({
    reasonId: r.reasonId,
    reasonName: r.reasonName,
    totalDuration: r._sum.totalDuration || 0,
    occurrenceCount: r._sum.occurrenceCount || 0,
    affectedReports: r._sum.affectedReports || 0,
  }));
}

// ============================================================
// Weekly Trend Queries
// ============================================================

export async function getWeeklyTrend(siteId: string, weekStart?: string | null) {
  if (weekStart) {
    return db.siteWeeklyTrend.findUnique({
      where: { siteId_weekStart: { siteId, weekStart } },
    });
  }

  // Get latest week
  const weeks = await db.siteWeeklyTrend.findMany({
    where: { siteId },
    orderBy: { weekStart: 'desc' },
    take: 1,
  });

  return weeks[0] || null;
}

export async function getWeeklyTrends(siteId: string, limit = 12) {
  return db.siteWeeklyTrend.findMany({
    where: { siteId },
    orderBy: { weekStart: 'desc' },
    take: limit,
  });
}

// ============================================================
// Dashboard Aggregations
// ============================================================

export interface DashboardData {
  today: {
    piles: number;
    drilling: number;
    downtime: number;
    reports: number;
  };
  week: {
    piles: number;
    drilling: number;
    downtime: number;
    reports: number;
  };
  topDowntimeReasons: Array<{
    reasonName: string;
    totalDuration: number;
  }>;
  trend: Array<{
    date: string;
    piles: number;
    drilling: number;
    downtime: number;
  }>;
}

export async function getFullDashboard(
  siteId: string,
  date: string
): Promise<DashboardData> {
  const today = new Date(date);
  const weekAgo = new Date(today);
  weekAgo.setDate(today.getDate() - 7);

  const [todaySummary, weekSummaries, downtimeReasons, trendData] = await Promise.all([
    db.siteDailySummary.findUnique({
      where: { siteId_date: { siteId, date } },
    }),
    db.siteDailySummary.findMany({
      where: {
        siteId,
        date: { gte: weekAgo.toISOString().split('T')[0], lte: date },
      },
      orderBy: { date: 'asc' },
    }),
    db.downtimeSummary.findMany({
      where: { siteId, date },
      orderBy: { totalDuration: 'desc' },
      take: 5,
    }),
    db.siteDailySummary.findMany({
      where: {
        siteId,
        date: { gte: weekAgo.toISOString().split('T')[0], lte: date },
      },
      orderBy: { date: 'asc' },
    }),
  ]);

  const weekPiles = weekSummaries.reduce((s, d) => s + d.totalPiles, 0);
  const weekDrilling = weekSummaries.reduce((s, d) => s + d.totalDrilling, 0);
  const weekDowntime = weekSummaries.reduce((s, d) => s + d.totalDowntime, 0);
  const weekReports = weekSummaries.reduce((s, d) => s + d.reportCount, 0);

  return {
    today: {
      piles: todaySummary?.totalPiles || 0,
      drilling: todaySummary?.totalDrilling || 0,
      downtime: todaySummary?.totalDowntime || 0,
      reports: todaySummary?.reportCount || 0,
    },
    week: {
      piles: weekPiles,
      drilling: weekDrilling,
      downtime: weekDowntime,
      reports: weekReports,
    },
    topDowntimeReasons: downtimeReasons.map(r => ({
      reasonName: r.reasonName,
      totalDuration: r.totalDuration,
    })),
    trend: trendData.map(d => ({
      date: d.date,
      piles: d.totalPiles,
      drilling: d.totalDrilling,
      downtime: d.totalDowntime,
    })),
  };
}
