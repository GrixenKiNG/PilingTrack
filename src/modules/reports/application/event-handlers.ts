/**
 * Report Event Handlers — Concrete handlers
 *
 * Subscribes to domain events and performs side effects:
 * - Analytics projections (report_analytics, site_daily_summary)
 * - Alerts (high downtime)
 * - Audit trail
 */

import { ReportDomainEvent } from '../domain';
import { on } from './event-bus';
import { logger } from '@/lib/logger';

// ============================================================
// Analytics Projection Handler
// ============================================================

function registerAnalyticsHandlers() {
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
        tenantId: null,
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
// Alert Handler
// ============================================================

function registerAlertHandlers() {
  on('DowntimeAdded', handleDowntimeAlert);
}

async function handleDowntimeAlert(event: ReportDomainEvent) {
  const duration = (event.data.duration as number) || 0;

  if (duration > 120) {
    logger.warn('High downtime detected', {
      duration,
      siteId: event.siteId,
      reportId: event.aggregateId,
      reasonId: event.data.reasonId,
    });
    // TODO: Send Telegram notification
  }
}

// ============================================================
// Audit Trail Handler
// ============================================================

function registerAuditHandlers() {
  on('ReportCreated', handleAuditEvent);
  on('ReportSubmitted', handleAuditEvent);
}

async function handleAuditEvent(event: ReportDomainEvent) {
  try {
    const { recordAuditEvent } = await import('@/services/audit/audit-service');

    await recordAuditEvent({
      action: event.type,
      scope: 'reports',
      actorId: event.userId,
      targetId: event.aggregateId,
      tenantId: null,
      requestId: event.metadata?.requestId as string,
      metadata: {
        eventType: event.type,
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
// Registration
// ============================================================

export function registerAllReportEventHandlers() {
  registerAnalyticsHandlers();
  registerAlertHandlers();
  registerAuditHandlers();
}
