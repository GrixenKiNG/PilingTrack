/**
 * Projection handlers — обновление денормализованных read-моделей по одному
 * событию. Выделено из projection-worker.ts (аудит A-8); воркер-цикл и
 * нормализация событий остались там.
 *
 * После 17.08.2026 здесь ровно одна модель — SiteWeeklyTrend.
 */

import { db } from '@/lib/db';

// Здесь до 17.08.2026 жили projectReportStats, projectOperatorPerformance,
// projectOperatorPerformanceFull и projectDowntimeSummary — 255 строк, три
// upsert-а на каждое событие отчёта. Их читателем был только мёртвый
// cqrs-query.service.ts, удалённый в тот же день: ни одна витрина к
// ReportStats, OperatorPerformance и DowntimeSummary не обращалась.
//
// Данные не потеряны: все три проекции целиком выводятся из Report, который
// и есть источник истины. Понадобится экран производительности — расчёт
// восстанавливается из истории git вместе с формулами pilesPerHour и
// drillingPerHour, каких у живой аналитики сейчас нет.
//
// Остался projectWeeklyTrend: SiteWeeklyTrend читает вкладка «Тренды».
/**
 * @param refDate дата смены (YYYY-MM-DD), неделя которой пересчитывается.
 *   Без неё берётся текущая неделя — так ходит только часовой пересчёт по
 *   всем объектам. Событийный путь обязан передавать дату отчёта: раньше
 *   неделя всегда считалась от `new Date()`, поэтому отчёт за прошлую неделю
 *   обновлял тренд текущей, а своя неделя так и оставалась без строки.
 */
export async function projectWeeklyTrend(siteId: string, refDate?: string | null) {
  const reference = refDate && /^\d{4}-\d{2}-\d{2}$/.test(refDate)
    ? new Date(`${refDate}T00:00:00Z`)
    : new Date();
  // UTC-арифметика: у локальной дата смены на границе суток съезжает на день.
  const dayOfWeek = reference.getUTCDay() || 7;
  const monday = new Date(reference);
  monday.setUTCDate(reference.getUTCDate() - dayOfWeek + 1);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

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
