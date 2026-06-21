/**
 * Event Handlers — Concrete handlers for domain events
 *
 * Each handler subscries to specific event types and performs
 * side effects: analytics projections, audit logs, alerts, notifications.
 *
 * These are registered once on server startup.
 */

import { ReportDomainEvent, REPORT_DOMAIN_EVENT_TYPES } from '@/modules/reports/domain';
import { on } from '@/services/reports/domain-events';
import { logger } from '@/lib/logger';

// ============================================================
// Analytics Projection Handler
// ============================================================

export function registerAnalyticsEventHandler() {
  on(REPORT_DOMAIN_EVENT_TYPES.REPORT_CREATED, handleReportForAnalytics);
  on(REPORT_DOMAIN_EVENT_TYPES.REPORT_SUBMITTED, handleReportForAnalytics);
  // SiteDailySummary used to be maintained incrementally from item-level
  // events (PILE_WORK_ADDED / DRILLING_ADDED / DOWNTIME_ADDED). That had two
  // bugs: (1) `siteId || ''` fallback wrote rows with an empty key when an
  // event lacked siteId, and (2) reportCount was incremented per work item
  // instead of per report, so one report with 5 piles + 3 drillings counted
  // as 8 reports. Rebuilding from the Report row on REPORT_SUBMITTED /
  // REPORT_UPDATED is idempotent and matches scripts/backfill-projections.ts.
  on(REPORT_DOMAIN_EVENT_TYPES.REPORT_SUBMITTED, handleReportForDailySummary);
  on(REPORT_DOMAIN_EVENT_TYPES.REPORT_UPDATED,   handleReportForDailySummary);
}

async function handleReportForAnalytics(event: ReportDomainEvent) {
  // Critical projection — errors must propagate so the outbox publisher
  // can retry / DLQ. The local catch logs context and re-throws.
  try {
    const { db } = await import('@/lib/db');

    // `event.aggregateId` is Report.reportId (uuid) — the outbox emit
    // passes state.reportId, not state.id. ReportAnalytics.reportId is
    // also the uuid form (every query joins r.reportId = ra.reportId),
    // so we write event.aggregateId directly.
    //
    // Older emit sites sometimes lacked siteId/userId/tenantId; fall back
    // to a Report lookup by reportId to fill the gaps. Skip if Report is
    // missing entirely (replay of a deleted aggregate).
    let siteId = event.siteId;
    let userId = event.userId;
    let tenantId = event.tenantId;
    if (!siteId || !userId) {
      const report = await db.report.findUnique({
        where: { reportId: event.aggregateId },
        select: { siteId: true, userId: true, tenantId: true },
      });
      siteId = siteId || report?.siteId;
      userId = userId || report?.userId;
      tenantId = tenantId || report?.tenantId || undefined;
    }
    if (!siteId || !userId) {
      logger.warn('ReportAnalytics skipped: cannot resolve siteId/userId', {
        eventType: event.type, aggregateId: event.aggregateId,
      });
      return;
    }

    await db.reportAnalytics.upsert({
      where: { reportId: event.aggregateId },
      create: {
        reportId: event.aggregateId,
        siteId,
        userId,
        tenantId: tenantId || null,
        status: event.type === REPORT_DOMAIN_EVENT_TYPES.REPORT_SUBMITTED ? 'submitted' : 'draft',
        totalPiles: (event.data.totalPiles as number) || 0,
        totalDrilling: (event.data.totalDrilling as number) || 0,
        totalDowntime: (event.data.totalDowntime as number) || 0,
        lastEventAt: new Date(event.occurredAt),
      },
      update: {
        status: event.type === REPORT_DOMAIN_EVENT_TYPES.REPORT_SUBMITTED ? 'submitted' : undefined,
        totalPiles: (event.data.totalPiles as number) !== undefined
          ? event.data.totalPiles as number
          : undefined,
        totalDrilling: (event.data.totalDrilling as number) !== undefined
          ? event.data.totalDrilling as number
          : undefined,
        totalDowntime: (event.data.totalDowntime as number) !== undefined
          ? event.data.totalDowntime as number
          : undefined,
        lastEventAt: new Date(event.occurredAt),
      },
    });
  } catch (error) {
    logger.error('Analytics projection failed', error, {
      eventType: event.type,
      reportId: event.aggregateId,
    });
    throw error;
  }
}

/**
 * Recompute SiteDailySummary for the (siteId, date) of a given report.
 *
 * Idempotent: aggregates piles/drillings/downtimes/reportCount across ALL
 * reports for that site+date, then upserts. Safe to call repeatedly.
 *
 * Triggered on REPORT_SUBMITTED / REPORT_UPDATED — i.e. once per report
 * lifecycle change, never per work item.
 */
export async function recomputeSiteDailySummary(siteId: string, date: string) {
  const { db } = await import('@/lib/db');
  const reports = await db.report.findMany({
    where: { siteId, date },
    select: {
      piles: { select: { count: true } },
      drillings: { select: { meters: true } },
      downtimes: { select: { duration: true } },
    },
  });
  const totalPiles = reports.reduce(
    (sum, r) => sum + r.piles.reduce((a, p) => a + (p.count || 0), 0), 0);
  const totalDrilling = reports.reduce(
    (sum, r) => sum + r.drillings.reduce((a, d) => a + (d.meters || 0), 0), 0);
  const totalDowntime = reports.reduce(
    (sum, r) => sum + r.downtimes.reduce((a, d) => a + (d.duration || 0), 0), 0);
  const reportCount = reports.length;

  if (reportCount === 0) {
    // Last report on this day was deleted — drop the row so admin charts
    // don't show a phantom zero day.
    await db.siteDailySummary.deleteMany({ where: { siteId, date } });
    return;
  }

  await db.siteDailySummary.upsert({
    where: { siteId_date: { siteId, date } },
    create: { siteId, date, totalPiles, totalDrilling, totalDowntime, reportCount },
    update: { totalPiles, totalDrilling, totalDowntime, reportCount },
  });
}

async function handleReportForDailySummary(event: ReportDomainEvent) {
  // Bug guard: never write a daily-summary row keyed on an empty siteId.
  if (!event.siteId) {
    logger.warn('SiteDailySummary skipped: missing siteId on event', {
      eventType: event.type, aggregateId: event.aggregateId,
    });
    return;
  }

  // Resolve the report's date from the event payload first; fall back to
  // the report row itself for older events that don't carry it.
  let date = (event.data?.date as string | undefined) || null;
  if (!date) {
    const { db } = await import('@/lib/db');
    const report = await db.report.findUnique({
      where: { id: event.aggregateId },
      select: { date: true },
    });
    date = report?.date || null;
  }
  if (!date) {
    logger.warn('SiteDailySummary skipped: cannot resolve report date', {
      eventType: event.type, aggregateId: event.aggregateId,
    });
    return;
  }

  // Critical projection — propagate so outbox publisher can retry / DLQ.
  try {
    await recomputeSiteDailySummary(event.siteId, date);
  } catch (error) {
    logger.error('SiteDailySummary recompute failed', error, {
      eventType: event.type, aggregateId: event.aggregateId,
      siteId: event.siteId, date,
    });
    throw error;
  }
}

// ============================================================
// Alert Handler — notifies on critical events
// ============================================================

export function registerAlertEventHandler() {
  on(REPORT_DOMAIN_EVENT_TYPES.DOWNTIME_ADDED, handleDowntimeAlert);
}

async function handleDowntimeAlert(event: ReportDomainEvent) {
  const duration = (event.data.duration as number) || 0;

  if (duration <= 120) return;

  logger.warn('High downtime detected', {
    duration,
    siteId: event.siteId,
    reportId: event.aggregateId,
    reasonId: event.data.reasonId,
  });

  try {
    const { telegramNotifier } = await import('@/core/notifications/telegram');
    await telegramNotifier.sendAlert({
      severity: duration > 240 ? 'high' : 'medium',
      message: `Простой ${duration} мин зафиксирован в отчёте`,
      siteId: event.siteId,
      reportId: event.aggregateId,
    });
  } catch (err) {
    // Notification must never fail the event — log and continue.
    // The audit/projection paths re-throw on failure (see emitDomainEvent
    // contract); alerts are best-effort.
    logger.error('Telegram downtime alert failed', err, {
      reportId: event.aggregateId,
      duration,
    });
  }
}

// ============================================================
// Audit Trail Handler
// ============================================================

export function registerAuditEventHandler() {
  on(REPORT_DOMAIN_EVENT_TYPES.REPORT_CREATED, handleAuditEvent);
  on(REPORT_DOMAIN_EVENT_TYPES.REPORT_UPDATED, handleAuditEvent);
  on(REPORT_DOMAIN_EVENT_TYPES.REPORT_SUBMITTED, handleAuditEvent);
  on(REPORT_DOMAIN_EVENT_TYPES.REPORT_VERSION_CREATED, handleAuditEvent);
}

async function handleAuditEvent(event: ReportDomainEvent) {
  try {
    const { recordAuditEvent } = await import('@/services/audit/audit-service');

    await recordAuditEvent({
      action: event.type,
      scope: 'reports',
      actorId: event.userId,
      targetId: event.aggregateId,
      tenantId: event.tenantId,
      requestId: event.metadata?.requestId as string,
      metadata: {
        eventType: event.type,
        aggregateType: event.aggregateType,
        version: event.version,
        data: event.data,
      },
    });
  } catch (error) {
    logger.error('Audit event recording failed', error, {
      eventType: event.type,
      aggregateId: event.aggregateId,
    });
  }
}

// ============================================================
// Telegram Notification Handler — submitted reports go to chat
// ============================================================

export function registerTelegramReportHandler() {
  on(REPORT_DOMAIN_EVENT_TYPES.REPORT_SUBMITTED, handleReportSubmittedTelegram);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtNum(n: number): string {
  return new Intl.NumberFormat('ru-RU').format(n);
}

async function handleReportSubmittedTelegram(event: ReportDomainEvent) {
  try {
    const { db } = await import('@/lib/db');

    // If there are newer unprocessed ReportSubmitted events for the same report,
    // skip this one — only the last event in the batch should send the PDF.
    // This prevents Telegram spam when the outbox catches up after downtime.
    const newerPending = await db.outboxEvent.count({
      where: {
        aggregateId: event.aggregateId,
        type: REPORT_DOMAIN_EVENT_TYPES.REPORT_SUBMITTED,
        published: false,
        id: { not: event.id },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped external/library boundary
      } as any,
    });
    if (newerPending > 0) {
      logger.info('Telegram: skipping outdated ReportSubmitted, newer pending in outbox', {
        reportId: event.aggregateId,
        newerPending,
      });
      return;
    }

    const { loadSingleReportPdfContext } = await import('@/lib/pdf-data');
    const { generateSinglePdf } = await import('@/lib/pdf-generator');
    const { telegramNotifier } = await import('@/core/notifications/telegram');

    const ctx = await loadSingleReportPdfContext(event.aggregateId);
    if (!ctx) {
      logger.warn('Telegram: report not found for submitted event', { reportId: event.aggregateId });
      return;
    }

    const d = ctx.pdfData;
    // Resubmit detection: every save bumps Report.version. version === 1 means
    // first time the report transitions draft→submitted; > 1 means an admin
    // (or anyone with edit-window access) changed an already-submitted report.
    const reportVersion = (ctx.report as { version?: number } | null)?.version ?? 1;
    const isCorrection = reportVersion > 1;
    const operatorName = (ctx.report?.lastEditedByName) || d.user?.name || '—';

    const totalPiles = d.piles.reduce((s, p) => s + (p.count || 0), 0);
    const totalDrilling = d.drillings.reduce((s, x) => s + (x.meters || 0), 0);
    const totalDowntime = d.downtimes.reduce((s, x) => s + (x.duration || 0), 0);

    const lines = [
      isCorrection
        ? `✏️ <b>Корректировка отчёта</b> (ред. №${reportVersion})`
        : '📋 <b>Отчёт отправлен</b>',
      '',
      `📍 Объект: <b>${escapeHtml(d.site?.name || '—')}</b>`,
      `📅 Дата: <b>${escapeHtml(d.date)}</b>`,
      `👷 Оператор: <b>${escapeHtml(d.user?.name || '—')}</b>`,
      ...(isCorrection ? [`🖊 Изменил: <b>${escapeHtml(operatorName)}</b>`] : []),
      `🛠 Оборудование: ${escapeHtml(d.equipmentName || '—')}`,
      '',
      `🔩 Свай забито: <b>${fmtNum(totalPiles)}</b> шт`,
      `🌀 Бурение: <b>${fmtNum(totalDrilling)}</b> м.п.`,
      `⏸ Простои: <b>${fmtNum(totalDowntime)}</b> ч`,
    ];
    const caption = lines.join('\n');

    const pdfBuffer = await generateSinglePdf(d);
    const filename = `report-${d.date}-${d.user?.name || 'unknown'}.pdf`.replace(/[^A-Za-z0-9._-]/g, '_');

    await telegramNotifier.sendDocument(filename, pdfBuffer, caption);
  } catch (error) {
    logger.error('Telegram report notification failed', error, {
      reportId: event.aggregateId,
    });
  }
}

// ============================================================
// Registration — call once on server startup
// ============================================================

export function registerAllEventHandlers() {
  registerAnalyticsEventHandler();
  registerAlertEventHandler();
  registerAuditEventHandler();
  registerTelegramReportHandler();
}
