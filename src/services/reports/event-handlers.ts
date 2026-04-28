/**
 * Event Handlers — Concrete handlers for domain events
 *
 * Each handler subscries to specific event types and performs
 * side effects: analytics projections, audit logs, alerts, notifications.
 *
 * These are registered once on server startup.
 */

import { ReportDomainEvent, REPORT_DOMAIN_EVENT_TYPES } from '@/modules/reports/domain';
import { emitDomainEvent, on } from '@/services/reports/domain-events';
import { logger } from '@/lib/logger';

// ============================================================
// Analytics Projection Handler
// ============================================================

export function registerAnalyticsEventHandler() {
  on(REPORT_DOMAIN_EVENT_TYPES.REPORT_CREATED, handleReportForAnalytics);
  on(REPORT_DOMAIN_EVENT_TYPES.REPORT_SUBMITTED, handleReportForAnalytics);
  on(REPORT_DOMAIN_EVENT_TYPES.PILE_WORK_ADDED, handlePileWorkForAnalytics);
  on(REPORT_DOMAIN_EVENT_TYPES.DRILLING_ADDED, handleDrillingForAnalytics);
  on(REPORT_DOMAIN_EVENT_TYPES.DOWNTIME_ADDED, handleDowntimeForAnalytics);
}

async function handleReportForAnalytics(event: ReportDomainEvent) {
  try {
    const { db } = await import('@/lib/db');

    await db.reportAnalytics.upsert({
      where: { reportId: event.aggregateId },
      create: {
        reportId: event.aggregateId,
        siteId: event.siteId || '',
        userId: event.userId || '',
        tenantId: event.tenantId || null,
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
  }
}

async function handlePileWorkForAnalytics(event: ReportDomainEvent) {
  try {
    const { db } = await import('@/lib/db');

    await db.siteDailySummary.upsert({
      where: {
        siteId_date: {
          siteId: event.siteId || '',
          date: new Date().toISOString().split('T')[0],
        },
      },
      create: {
        siteId: event.siteId || '',
        date: new Date().toISOString().split('T')[0],
        totalPiles: (event.data.count as number) || 0,
        totalDrilling: 0,
        totalDowntime: 0,
        reportCount: 1,
      },
      update: {
        totalPiles: { increment: (event.data.count as number) || 0 },
        reportCount: { increment: 1 },
      },
    });
  } catch (error) {
    logger.error('Pile work analytics failed', error, {
      eventType: event.type,
      aggregateId: event.aggregateId,
    });
  }
}

async function handleDrillingForAnalytics(event: ReportDomainEvent) {
  try {
    const { db } = await import('@/lib/db');
    const meters = (event.data.meters as number) || 0;

    await db.siteDailySummary.upsert({
      where: {
        siteId_date: {
          siteId: event.siteId || '',
          date: new Date().toISOString().split('T')[0],
        },
      },
      create: {
        siteId: event.siteId || '',
        date: new Date().toISOString().split('T')[0],
        totalPiles: 0,
        totalDrilling: meters,
        totalDowntime: 0,
        reportCount: 1,
      },
      update: {
        totalDrilling: { increment: meters },
        reportCount: { increment: 1 },
      },
    });
  } catch (error) {
    logger.error('Drilling analytics failed', error, {
      eventType: event.type,
      aggregateId: event.aggregateId,
    });
  }
}

async function handleDowntimeForAnalytics(event: ReportDomainEvent) {
  try {
    const { db } = await import('@/lib/db');
    const duration = (event.data.duration as number) || 0;

    await db.siteDailySummary.upsert({
      where: {
        siteId_date: {
          siteId: event.siteId || '',
          date: new Date().toISOString().split('T')[0],
        },
      },
      create: {
        siteId: event.siteId || '',
        date: new Date().toISOString().split('T')[0],
        totalPiles: 0,
        totalDrilling: 0,
        totalDowntime: duration,
        reportCount: 1,
      },
      update: {
        totalDowntime: { increment: duration },
      },
    });
  } catch (error) {
    logger.error('Downtime analytics failed', error, {
      eventType: event.type,
      aggregateId: event.aggregateId,
    });
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

  // Alert if downtime > 2 hours (120 min)
  if (duration > 120) {
    logger.warn('High downtime detected', {
      duration,
      siteId: event.siteId,
      reportId: event.aggregateId,
      reasonId: event.data.reasonId,
    });

    // TODO: Send Telegram notification
    // await sendTelegramAlert({
    //   message: `Простой ${duration}мин на объекте ${event.siteId}`,
    //   siteId: event.siteId,
    // });
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
