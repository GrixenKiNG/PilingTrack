/**
 * Event Handlers — Concrete handlers for domain events
 *
 * Each handler subscries to specific event types and performs
 * side effects: analytics projections, audit logs, alerts, notifications.
 *
 * These are registered once on server startup.
 */

import { ReportDomainEvent } from '@/modules/reports/domain';
import { emitDomainEvent, on } from '@/services/reports/domain-events';
import { logger } from '@/lib/logger';

// ============================================================
// Analytics Projection Handler
// ============================================================

export function registerAnalyticsEventHandler() {
  on('ReportCreated', handleReportForAnalytics);
  on('ReportSubmitted', handleReportForAnalytics);
  on('PileWorkAdded', handlePileWorkForAnalytics);
  on('DrillingAdded', handleDrillingForAnalytics);
  on('DowntimeAdded', handleDowntimeForAnalytics);
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
        status: event.type === 'ReportSubmitted' ? 'submitted' : 'draft',
        totalPiles: (event.data.totalPiles as number) || 0,
        totalDrilling: (event.data.totalDrilling as number) || 0,
        totalDowntime: (event.data.totalDowntime as number) || 0,
        lastEventAt: new Date(event.occurredAt),
      },
      update: {
        status: event.type === 'ReportSubmitted' ? 'submitted' : undefined,
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
  on('DowntimeAdded', handleDowntimeAlert);
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
  on('ReportCreated', handleAuditEvent);
  on('ReportUpdated', handleAuditEvent);
  on('ReportSubmitted', handleAuditEvent);
  on('ReportVersionCreated', handleAuditEvent);
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
// Registration — call once on server startup
// ============================================================

export function registerAllEventHandlers() {
  registerAnalyticsEventHandler();
  registerAlertEventHandler();
  registerAuditEventHandler();
}
