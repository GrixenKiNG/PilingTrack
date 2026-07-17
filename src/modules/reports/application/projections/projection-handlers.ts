/**
 * Projection handlers — обновление денормализованных read-моделей по одному
 * событию (stats, operator-performance, downtime, weekly trend).
 * Выделено из projection-worker.ts (аудит A-8); воркер-цикл и нормализация
 * событий остались там. projectOperatorPerformanceFull re-export'ится из
 * projection-worker, внешние импортёры не меняются.
 */

import { db } from '@/lib/db';
import { ReportDomainEvent, REPORT_DOMAIN_EVENT_TYPES } from '@/modules/reports/domain';
import { getProjectionDate } from './projection-worker';

export async function projectReportStats(event: ReportDomainEvent) {
  const { siteId, userId, tenantId } = event;
  if (!siteId || !userId) return;

  const report = await db.report.findUnique({
    where: { reportId: event.aggregateId },
    include: {
      piles: true,
      drillings: true,
      downtimes: true,
    },
  });

  if (!report) return;

  const date = getProjectionDate(event, report.date);
  if (!date) return;

  let topReasonId: string | null = null;
  let topReasonDuration: number | null = null;
  if (report.downtimes.length > 0) {
    const byReason = new Map<string, number>();
    for (const downtime of report.downtimes) {
      byReason.set(downtime.reasonId, (byReason.get(downtime.reasonId) || 0) + downtime.duration);
    }

    let maxDuration = 0;
    for (const [reasonId, duration] of byReason) {
      if (duration > maxDuration) {
        maxDuration = duration;
        topReasonId = reasonId;
        topReasonDuration = duration;
      }
    }
  }

  let pilesPerHour: number | null = null;
  let drillingPerHour: number | null = null;
  if (report.shiftStart && report.shiftEnd) {
    const [shiftStartHours, shiftStartMinutes] = report.shiftStart.split(':').map(Number);
    const [shiftEndHours, shiftEndMinutes] = report.shiftEnd.split(':').map(Number);
    let hours =
      (shiftEndHours * 60 + shiftEndMinutes - shiftStartHours * 60 - shiftStartMinutes) / 60;
    if (hours < 0) hours += 24;

    if (hours > 0) {
      const totalPiles = report.piles.reduce((sum, pile) => sum + pile.count, 0);
      const totalDrilling = report.drillings.reduce((sum, drilling) => sum + drilling.meters, 0);
      pilesPerHour = Math.round((totalPiles / hours) * 100) / 100;
      drillingPerHour = Math.round((totalDrilling / hours) * 100) / 100;
    }
  }

  const totalPiles = report.piles.reduce((sum, pile) => sum + pile.count, 0);
  const totalDrilling = report.drillings.reduce((sum, drilling) => sum + drilling.meters, 0);
  const totalDowntime = report.downtimes.reduce((sum, downtime) => sum + downtime.duration, 0);

  await db.reportStats.upsert({
    where: { reportId: report.reportId },
    create: {
      reportId: report.reportId,
      siteId,
      userId,
      tenantId: tenantId || null,
      date,
      shiftType: report.shiftType,
      totalPiles,
      totalDrilling,
      totalDowntime,
      downtimeCount: report.downtimes.length,
      pileGradeCount: new Set(report.piles.map((pile) => pile.pileGradeId)).size,
      drillingCount: report.drillings.length,
      pilesPerHour,
      drillingPerHour,
      topDowntimeReasonId: topReasonId,
      topDowntimeDuration: topReasonDuration,
    },
    update: {
      totalPiles,
      totalDrilling,
      totalDowntime,
      downtimeCount: report.downtimes.length,
      pileGradeCount: new Set(report.piles.map((pile) => pile.pileGradeId)).size,
      drillingCount: report.drillings.length,
      pilesPerHour,
      drillingPerHour,
      topDowntimeReasonId: topReasonId,
      topDowntimeDuration: topReasonDuration,
    },
  });
}

export async function projectOperatorPerformance(event: ReportDomainEvent) {
  if (
    event.type !== REPORT_DOMAIN_EVENT_TYPES.REPORT_SUBMITTED &&
    event.type !== REPORT_DOMAIN_EVENT_TYPES.REPORT_CREATED
  ) {
    return;
  }

  const { siteId, userId } = event;
  if (!siteId || !userId) return;

  // Aggregate by the report's WORK date, not the event's occurredAt. occurredAt
  // is the submission instant (UTC); operators routinely file reports for an
  // earlier shift, so occurredAt's date sends projectOperatorPerformanceFull to
  // a day with no reports and it silently writes nothing — the gap that left
  // the operator analytics undercounting (33 of 63 reports on prod).
  const report = await db.report.findUnique({
    where: { reportId: event.aggregateId },
    select: { date: true },
  });
  if (!report) return;

  await projectOperatorPerformanceFull(userId, siteId, report.date);
}

export async function projectOperatorPerformanceFull(userId: string, siteId: string, date: string) {
  const reports = await db.report.findMany({
    where: { userId, siteId, date },
    include: {
      piles: true,
      drillings: true,
      downtimes: true,
      user: { select: { name: true } },
      site: { select: { name: true } },
    },
  });

  if (reports.length === 0) return;

  const totalPiles = reports.reduce(
    (sum, report) => sum + report.piles.reduce((pileSum, pile) => pileSum + pile.count, 0),
    0
  );
  const totalDrilling = reports.reduce(
    (sum, report) =>
      sum + report.drillings.reduce((drillingSum, drilling) => drillingSum + drilling.meters, 0),
    0
  );
  const totalDowntime = reports.reduce(
    (sum, report) =>
      sum + report.downtimes.reduce((downtimeSum, downtime) => downtimeSum + downtime.duration, 0),
    0
  );
  const reportCount = reports.length;

  let totalShiftMinutes = 0;
  for (const report of reports) {
    if (report.shiftStart && report.shiftEnd) {
      const [shiftStartHours, shiftStartMinutes] = report.shiftStart.split(':').map(Number);
      const [shiftEndHours, shiftEndMinutes] = report.shiftEnd.split(':').map(Number);
      let minutes =
        shiftEndHours * 60 + shiftEndMinutes - shiftStartHours * 60 - shiftStartMinutes;
      if (minutes < 0) minutes += 24 * 60;
      totalShiftMinutes += minutes;
    }
  }

  // ReportDowntime.duration is stored in HOURS (the report form collects
  // hours), while totalShiftMinutes is in minutes — convert before dividing,
  // else the ratio came out ~60× too small.
  const downtimeRatio = totalShiftMinutes > 0 ? (totalDowntime * 60) / totalShiftMinutes : 0;

  await db.operatorPerformance.upsert({
    where: { userId_siteId_date: { userId, siteId, date } },
    create: {
      userId,
      userName: reports[0].user?.name || '',
      siteId,
      siteName: reports[0].site?.name || '',
      tenantId: reports[0].tenantId || null,
      date,
      totalPiles,
      totalDrilling,
      totalDowntime,
      reportCount,
      avgPilesPerReport: reportCount > 0 ? totalPiles / reportCount : null,
      avgDrillingPerReport: reportCount > 0 ? Math.round((totalDrilling / reportCount) * 100) / 100 : null,
      avgDowntimePerReport: reportCount > 0 ? Math.round((totalDowntime / reportCount) * 100) / 100 : null,
      downtimeRatio: Math.round(downtimeRatio * 10000) / 10000,
    },
    update: {
      totalPiles,
      totalDrilling,
      totalDowntime,
      reportCount,
      avgPilesPerReport: reportCount > 0 ? totalPiles / reportCount : null,
      avgDrillingPerReport: reportCount > 0 ? Math.round((totalDrilling / reportCount) * 100) / 100 : null,
      avgDowntimePerReport: reportCount > 0 ? Math.round((totalDowntime / reportCount) * 100) / 100 : null,
      downtimeRatio: Math.round(downtimeRatio * 10000) / 10000,
    },
  });
}

export async function projectDowntimeSummary(event: ReportDomainEvent) {
  if (event.type !== REPORT_DOMAIN_EVENT_TYPES.DOWNTIME_ADDED) return;

  const { siteId, tenantId } = event;
  if (!siteId) return;

  const date = getProjectionDate(event);
  if (!date) return;

  const reasonId = event.data.reasonId as string;
  if (!reasonId) return;

  const reason = await db.downtimeReason.findUnique({
    where: { id: reasonId },
    select: { name: true },
  });

  if (!reason) return;

  const allDowntimes = await db.reportDowntime.findMany({
    where: {
      reasonId,
      report: { siteId, date },
    },
  });

  const totalDuration = allDowntimes.reduce((sum, downtime) => sum + downtime.duration, 0);
  const uniqueReports = new Set(allDowntimes.map((downtime) => downtime.reportId)).size;

  const siteDowntimes = await db.reportDowntime.findMany({
    where: {
      report: { siteId, date },
    },
  });
  const siteTotal = siteDowntimes.reduce((sum, downtime) => sum + downtime.duration, 0);
  const percentage = siteTotal > 0 ? (totalDuration / siteTotal) * 100 : 0;

  await db.downtimeSummary.upsert({
    where: {
      siteId_date_reasonId: { siteId, date, reasonId },
    },
    create: {
      siteId,
      date,
      reasonId,
      reasonName: reason.name,
      tenantId: tenantId || null,
      totalDuration,
      occurrenceCount: allDowntimes.length,
      affectedReports: uniqueReports,
      percentageOfTotal: Math.round(percentage * 100) / 100,
    },
    update: {
      totalDuration,
      occurrenceCount: allDowntimes.length,
      affectedReports: uniqueReports,
      percentageOfTotal: Math.round(percentage * 100) / 100,
    },
  });
}

export async function projectWeeklyTrend(siteId: string) {
  const now = new Date();
  const dayOfWeek = now.getDay() || 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - dayOfWeek + 1);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const weekStart = monday.toISOString().split('T')[0];
  const weekEnd = sunday.toISOString().split('T')[0];

  // SiteWeeklyTrend.tenantId is NOT NULL in the DB (schema.prisma marks it
  // optional, hence the silent omission). Source it from the site.
  const site = await db.site.findUnique({
    where: { id: siteId },
    select: { tenantId: true },
  });

  const dailySummaries = await db.siteDailySummary.findMany({
    where: {
      siteId,
      date: { gte: weekStart, lte: weekEnd },
    },
    orderBy: { date: 'asc' },
  });

  const dailyMetrics = dailySummaries.map((summary) => ({
    date: summary.date,
    piles: summary.totalPiles,
    drilling: summary.totalDrilling,
    downtime: summary.totalDowntime,
    reports: summary.reportCount,
  }));

  const totalPiles = dailySummaries.reduce((sum, summary) => sum + summary.totalPiles, 0);
  const totalDrilling = dailySummaries.reduce((sum, summary) => sum + summary.totalDrilling, 0);
  const totalDowntime = dailySummaries.reduce((sum, summary) => sum + summary.totalDowntime, 0);
  const reportCount = dailySummaries.reduce((sum, summary) => sum + summary.reportCount, 0);

  let pilesTrend: string | null = null;
  let drillingTrend: string | null = null;
  let downtimeTrend: string | null = null;

  if (dailySummaries.length >= 2) {
    const last = dailySummaries[dailySummaries.length - 1];
    const previous = dailySummaries[dailySummaries.length - 2];

    pilesTrend =
      last.totalPiles > previous.totalPiles
        ? 'UP'
        : last.totalPiles < previous.totalPiles
          ? 'DOWN'
          : 'STABLE';
    drillingTrend =
      last.totalDrilling > previous.totalDrilling
        ? 'UP'
        : last.totalDrilling < previous.totalDrilling
          ? 'DOWN'
          : 'STABLE';
    downtimeTrend =
      last.totalDowntime < previous.totalDowntime
        ? 'UP'
        : last.totalDowntime > previous.totalDowntime
          ? 'DOWN'
          : 'STABLE';
  }

  await db.siteWeeklyTrend.upsert({
    where: { siteId_weekStart: { siteId, weekStart } },
    create: {
      siteId,
      tenantId: site?.tenantId ?? null,
      weekStart,
      weekEnd,
      dailyMetrics: dailyMetrics as never,
      totalPiles,
      totalDrilling,
      totalDowntime,
      reportCount,
      pilesTrend,
      drillingTrend,
      downtimeTrend,
    },
    update: {
      dailyMetrics: dailyMetrics as never,
      totalPiles,
      totalDrilling,
      totalDowntime,
      reportCount,
      pilesTrend,
      drillingTrend,
      downtimeTrend,
    },
  });
}
