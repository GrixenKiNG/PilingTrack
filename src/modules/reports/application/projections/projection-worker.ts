/**
 * Projection Worker — CQRS Read Model Updater
 *
 * Listens to domain events and updates denormalized read models:
 * - ReportStats: per-report aggregated stats
 * - OperatorPerformance: daily per-user metrics
 * - DowntimeSummary: per-site per-date downtime breakdown
 * - SiteDailySummary: existing daily aggregates
 * - SiteWeeklyTrend: weekly trend data
 *
 * Runs as a separate process for fault isolation.
 */

import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { ReportDomainEvent } from '@/modules/reports/domain';
import { projectOutboxEvents } from '@/services/reports/outbox-publisher';

// ============================================================
// Projection Handlers
// ============================================================

const PROJECTABLE_EVENT_PREFIXES = ['Report', 'Pile', 'Drilling', 'Downtime'];

function isProjectableReportEvent(event: unknown): event is ReportDomainEvent {
  if (!event || typeof event !== 'object') return false;

  const maybeEvent = event as Partial<ReportDomainEvent>;
  return (
    typeof maybeEvent.type === 'string' &&
    typeof maybeEvent.aggregateId === 'string' &&
    PROJECTABLE_EVENT_PREFIXES.some((prefix) => maybeEvent.type!.startsWith(prefix))
  );
}

function getProjectionDate(event: ReportDomainEvent, fallbackDate?: string | null): string | null {
  if (event.occurredAt) {
    const occurredAt = new Date(event.occurredAt);
    if (!Number.isNaN(occurredAt.getTime())) {
      return occurredAt.toISOString().split('T')[0];
    }
  }

  const eventDate = typeof event.data?.date === 'string' ? event.data.date : null;
  if (eventDate && /^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
    return eventDate;
  }

  return fallbackDate || null;
}

/**
 * Update ReportStats on report events.
 */
async function projectReportStats(event: ReportDomainEvent) {
  const { siteId, userId, tenantId, data } = event;
  if (!siteId || !userId) return;

  // We need the full report data — fetch it
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

  // Compute top downtime reason
  let topReasonId: string | null = null;
  let topReasonDuration: number | null = null;
  if (report.downtimes.length > 0) {
    const byReason = new Map<string, number>();
    for (const dt of report.downtimes) {
      byReason.set(dt.reasonId, (byReason.get(dt.reasonId) || 0) + dt.duration);
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

  // Compute piles/drilling per hour
  let pilesPerHour: number | null = null;
  let drillingPerHour: number | null = null;
  if (report.shiftStart && report.shiftEnd) {
    const [sh, sm] = report.shiftStart.split(':').map(Number);
    const [eh, em] = report.shiftEnd.split(':').map(Number);
    let hours = (eh * 60 + em - sh * 60 - sm) / 60;
    if (hours < 0) hours += 24;
    if (hours > 0) {
      const totalPiles = report.piles.reduce((s, p) => s + p.count, 0);
      const totalDrilling = report.drillings.reduce((s, d) => s + d.meters, 0);
      pilesPerHour = Math.round((totalPiles / hours) * 100) / 100;
      drillingPerHour = Math.round((totalDrilling / hours) * 100) / 100;
    }
  }

  const totalPiles = report.piles.reduce((s, p) => s + p.count, 0);
  const totalDrilling = report.drillings.reduce((s, d) => s + d.meters, 0);
  const totalDowntime = report.downtimes.reduce((s, d) => s + d.duration, 0);

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
      pileGradeCount: new Set(report.piles.map(p => p.pileGradeId)).size,
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
      pileGradeCount: new Set(report.piles.map(p => p.pileGradeId)).size,
      drillingCount: report.drillings.length,
      pilesPerHour,
      drillingPerHour,
      topDowntimeReasonId: topReasonId,
      topDowntimeDuration: topReasonDuration,
    },
  });
}

/**
 * Update OperatorPerformance on report submission.
 *
 * IDEMPOTENT: Uses full aggregation instead of increment to prevent
 * double-counting when events are processed multiple times.
 */
async function projectOperatorPerformance(event: ReportDomainEvent) {
  if (event.type !== 'ReportSubmitted' && event.type !== 'ReportCreated') return;

  const { siteId, userId, tenantId } = event;
  if (!siteId || !userId) return;

  // Always use full aggregation for idempotency — safe against double-processing
  const date = getProjectionDate(event);
  if (!date) return;

  await projectOperatorPerformanceFull(userId, siteId, date);
}

/**
 * Full aggregation fallback — used when event payload is not available.
 */
async function projectOperatorPerformanceFull(userId: string, siteId: string, date: string) {
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

  const totalPiles = reports.reduce((s, r) => s + r.piles.reduce((ps, p) => ps + p.count, 0), 0);
  const totalDrilling = reports.reduce((s, r) => s + r.drillings.reduce((ds, d) => ds + d.meters, 0), 0);
  const totalDowntime = reports.reduce((s, r) => s + r.downtimes.reduce((dt, d) => dt + d.duration, 0), 0);
  const reportCount = reports.length;

  let totalShiftMinutes = 0;
  for (const r of reports) {
    if (r.shiftStart && r.shiftEnd) {
      const [sh, sm] = r.shiftStart.split(':').map(Number);
      const [eh, em] = r.shiftEnd.split(':').map(Number);
      let mins = eh * 60 + em - sh * 60 - sm;
      if (mins < 0) mins += 24 * 60;
      totalShiftMinutes += mins;
    }
  }

  const downtimeRatio = totalShiftMinutes > 0 ? totalDowntime / totalShiftMinutes : 0;

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

/**
 * Update DowntimeSummary on downtime events.
 */
async function projectDowntimeSummary(event: ReportDomainEvent) {
  if (event.type !== 'DowntimeAdded') return;

  const { siteId, tenantId } = event;
  if (!siteId) return;

  const date = getProjectionDate(event);
  if (!date) return;

  const reasonId = event.data.reasonId as string;
  if (!reasonId) return;

  // Fetch reason name
  const reason = await db.downtimeReason.findUnique({
    where: { id: reasonId },
    select: { name: true },
  });

  if (!reason) return;

  // Get all downtimes for this site + date
  const allDowntimes = await db.reportDowntime.findMany({
    where: {
      reasonId,
      report: { siteId, date },
    },
  });

  const totalDuration = allDowntimes.reduce((s, d) => s + d.duration, 0);
  const uniqueReports = new Set(allDowntimes.map(d => d.reportId)).size;

  // Get total site downtime for percentage
  const siteDowntimes = await db.reportDowntime.findMany({
    where: {
      report: { siteId, date },
    },
  });
  const siteTotal = siteDowntimes.reduce((s, d) => s + d.duration, 0);
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

/**
 * Update SiteWeeklyTrend — recomputed weekly.
 */
async function projectWeeklyTrend(siteId: string) {
  const now = new Date();
  const dayOfWeek = now.getDay() || 7; // 1=Mon..7=Sun
  const monday = new Date(now);
  monday.setDate(now.getDate() - dayOfWeek + 1);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const weekStart = monday.toISOString().split('T')[0];
  const weekEnd = sunday.toISOString().split('T')[0];

  // Get daily summaries for the week
  const dailySummaries = await db.siteDailySummary.findMany({
    where: {
      siteId,
      date: { gte: weekStart, lte: weekEnd },
    },
    orderBy: { date: 'asc' },
  });

  const dailyMetrics = dailySummaries.map(ds => ({
    date: ds.date,
    piles: ds.totalPiles,
    drilling: ds.totalDrilling,
    downtime: ds.totalDowntime,
    reports: ds.reportCount,
  }));

  const totalPiles = dailySummaries.reduce((s, d) => s + d.totalPiles, 0);
  const totalDrilling = dailySummaries.reduce((s, d) => s + d.totalDrilling, 0);
  const totalDowntime = dailySummaries.reduce((s, d) => s + d.totalDowntime, 0);
  const reportCount = dailySummaries.reduce((s, d) => s + d.reportCount, 0);

  // Compute trends (compare last 2 days)
  let pilesTrend: string | null = null;
  let drillingTrend: string | null = null;
  let downtimeTrend: string | null = null;

  if (dailySummaries.length >= 2) {
    const last = dailySummaries[dailySummaries.length - 1];
    const prev = dailySummaries[dailySummaries.length - 2];

    pilesTrend = last.totalPiles > prev.totalPiles ? 'UP' : last.totalPiles < prev.totalPiles ? 'DOWN' : 'STABLE';
    drillingTrend = last.totalDrilling > prev.totalDrilling ? 'UP' : last.totalDrilling < prev.totalDrilling ? 'DOWN' : 'STABLE';
    downtimeTrend = last.totalDowntime < prev.totalDowntime ? 'UP' : last.totalDowntime > prev.totalDowntime ? 'DOWN' : 'STABLE'; // Less downtime = UP
  }

  await db.siteWeeklyTrend.upsert({
    where: { siteId_weekStart: { siteId, weekStart } },
    create: {
      siteId,
      weekStart,
      weekEnd,
      dailyMetrics: dailyMetrics as any,
      totalPiles,
      totalDrilling,
      totalDowntime,
      reportCount,
      pilesTrend,
      drillingTrend,
      downtimeTrend,
    },
    update: {
      dailyMetrics: dailyMetrics as any,
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

// ============================================================
// Main Projection Router
// ============================================================

async function projectEvent(event: ReportDomainEvent) {
  if (!isProjectableReportEvent(event)) {
    if (process.env.LOG_PROJECTION_SKIPS === 'true') {
      logger.debug('Projection skipped non-report event', {
        eventType: (event as { type?: string })?.type,
      });
    }
    return;
  }

  try {
    await Promise.all([
      projectReportStats(event),
      projectOperatorPerformance(event),
      projectDowntimeSummary(event),
    ]);

    // Weekly trend — update on any report event
    if (event.type.startsWith('Report') || event.type.startsWith('Pile') || event.type.startsWith('Drilling')) {
      if (event.siteId) {
        await projectWeeklyTrend(event.siteId);
      }
    }
  } catch (error) {
    logger.error('Projection failed', error, {
      eventType: event.type,
      aggregateId: event.aggregateId,
    });
  }
}

// ============================================================
// Worker Loop
// ============================================================

export function startProjectionWorker(intervalMs = 5000) {
  logger.info('Projection worker starting', { intervalMs });

  const processOnce = async () => {
    try {
      // Uses the dedicated `projected` consumer — independent of the
      // outbox publisher so both workers see every event exactly once.
      const count = await projectOutboxEvents(projectEvent);
      if (count > 0) {
        logger.info('Projection worker processed events', { count });
      }
    } catch (error) {
      logger.error('Projection worker error', error);
    }
  };

  void processOnce();
  const interval = setInterval(processOnce, intervalMs);

  // Weekly trend recomputation every hour
  const weeklyInterval = setInterval(async () => {
    try {
      const sites = await db.site.findMany({ select: { id: true } });
      for (const site of sites) {
        await projectWeeklyTrend(site.id);
      }
    } catch (error) {
      logger.error('Weekly trend recomputation failed', error);
    }
  }, 3600000); // 1 hour

  process.on('SIGTERM', () => {
    logger.info('Projection worker shutting down');
    clearInterval(interval);
    clearInterval(weeklyInterval);
  });

  process.on('SIGINT', () => {
    clearInterval(interval);
    clearInterval(weeklyInterval);
  });

  return {
    stop: () => {
      clearInterval(interval);
      clearInterval(weeklyInterval);
    },
  };
}
