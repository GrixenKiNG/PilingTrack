import {registerAnalyticsEventHandler} from "./event-handlers-analytics";
export {registerAnalyticsEventHandler, recomputeSiteDailySummary} from "./event-handlers-analytics";
import { createTelegramDeliveryProgress } from '@/core/notifications/telegram-delivery-progress';
/**
 * Event Handlers — Concrete handlers for domain events
 *
 * Each handler subscries to specific event types and performs
 * side effects: analytics projections, audit logs, alerts, notifications.
 *
 * These are registered once on server startup.
 */

import { ReportDomainEvent, REPORT_DOMAIN_EVENT_TYPES } from '../domain';
import { on } from './domain-events';
import { logger } from '@/lib/logger';
import { formatCountMeters } from '@/lib/format';
import { formatDowntimeHours } from '@/lib/downtime-hours';
import { pileLengthMeters } from '@/lib/pile-length';
import { transliterate } from '@/lib/transliterate';
import { enqueueAlert } from '@/core/notifications/durable-alert';
// Статически (в отличие от обработчиков ниже): динамический import этого
// модуля не подменяется моком в юнит-тесте, и путь «тенант из отчёта» иначе
// уходил бы в живую базу из теста. Прод-поведение то же — db это ленивый прокси.
import { db } from '@/lib/db';

// ============================================================
// Alert Handler — notifies on critical events
// ============================================================

export function registerAlertEventHandler() {
  on(REPORT_DOMAIN_EVENT_TYPES.DOWNTIME_ADDED, handleDowntimeAlert);
}

/**
 * Ключ дедупликации алерта о простое (F-R33-2); сам дедуп делает доставка
 * очереди (durable-alert-delivery).
 *
 * `DOWNTIME_ADDED` несёт только `reasonId`/`duration`/`comment` — id самой
 * строки простоя в `event.data` нет, а времени начала/окончания форма не
 * собирает вовсе (см. `addDowntime` в report.aggregate.ts). Поэтому стабильный
 * ключ строки собираем из того, что событие реально содержит: причина +
 * длительность. Пара `(reportId, reasonId, duration)` совпадает с той, что
 * советует аудит.
 *
 * Без организации ключ не строим: один на все тенанты он столкнул бы алерты
 * разных организаций между собой.
 */
function downtimeAlertKey(event: ReportDomainEvent): string | null {
  if (!event.tenantId) return null;
  const reasonId = (event.data.reasonId as string | undefined) || 'no-reason';
  const duration = (event.data.duration as number) || 0;
  return `alert:downtime:${event.tenantId}:${event.aggregateId}:${reasonId}:${duration}`;
}

async function handleDowntimeAlert(event: ReportDomainEvent) {
  // duration is in HOURS (the report form collects hours). This previously
  // used a 120/240 threshold as if it were minutes, so the alert never fired
  // for realistic shift downtime (2–11 h). Thresholds: >2 h warns, >4 h high.
  const duration = (event.data.duration as number) || 0;

  if (duration <= 2) return;

  // Организация обязательна: очередь доставки без неё не работает, а алерт без
  // организации ушёл бы мимо её настроек (fail closed).
  if (!event.tenantId) {
    logger.warn('Downtime alert skipped: event has no tenantId', { reportId: event.aggregateId });
    return;
  }

  // Признак из настроек организации. До этого переключатель «Простой…» на
  // экране настроек сохранялся, но отправку не спрашивали, и выключенное
  // правило всё равно слало алерт.
  const { isNotificationEnabled } = await import('@/modules/settings');
  if (!await isNotificationEnabled(event.tenantId, 'downtime30')) {
    logger.info('Downtime alert suppressed by tenant settings', {
      reportId: event.aggregateId, duration,
    });
    return;
  }

  logger.warn('High downtime detected', {
    duration,
    siteId: event.siteId,
    reportId: event.aggregateId,
    reasonId: event.data.reasonId,
  });

  // Человекочитаемые название объекта и номер отчёта вместо внутренних id
  // (cuid), которые диспетчеру ничего не говорят. Один тенантный запрос,
  // строгое равенство по организации события; при неудаче оставляем прежние
  // строки с id — фолбэк в telegram.ts.
  let siteName: string | undefined;
  let reportNumber: string | undefined;
  try {
    const report = await db.report.findFirst({
      where: { reportId: event.aggregateId, tenantId: event.tenantId },
      select: { reportId: true, site: { select: { name: true } } },
    });
    siteName = report?.site?.name || undefined;
    reportNumber = report?.reportId || undefined;
  } catch (err) {
    logger.warn('Downtime alert: cannot resolve site name/report number', {
      reportId: event.aggregateId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Часовой пояс организации для строки времени: серверное время в алерте
  // отставало от московского на 3 часа (F-R33-1). Незнание зоны — не повод
  // молчать, поэтому при ошибке оставляем "Europe/Moscow".
  let timeZone = 'Europe/Moscow';
  try {
    const { getSettings } = await import('@/modules/settings');
    timeZone = (await getSettings(event.tenantId)).timezone || 'Europe/Moscow';
  } catch {
    // Настройки не прочитались — шлём в зоне по умолчанию.
  }

  // В очередь, а не в Telegram: отправка (до 5 с) идёт в полосе Telegram
  // публикатора outbox и не держит остальные события. Дедуп по Redis, признак
  // «Простой» и повтор/DLQ — там же. Сбой записи не глотаем: outbox повторит
  // событие, иначе алерт потерялся бы.
  await enqueueAlert(db, {
    tenantId: event.tenantId,
    aggregateId: event.aggregateId,
    alert: {
      severity: duration > 4 ? 'high' : 'medium',
      message: `Простой ${formatDowntimeHours(duration)} зафиксирован в отчёте`,
      siteId: event.siteId,
      reportId: event.aggregateId,
      siteName,
      reportNumber,
      timeZone,
      notificationKey: 'downtime30',
      dedupeKey: downtimeAlertKey(event) ?? undefined,
    },
  });
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
    const { recordAuditEvent } = await import('@/modules/audit');

    // Автосдача черновика: смену закрыл планировщик по истечении
    // производственных суток, оператор отчёт не сдавал, и запись от его имени —
    // неправда (F-R34-18). Признак `autoClosed` кладёт в payload планировщик;
    // здесь он решает, что актора у записи нет (лента показывает «система»), а
    // имя владельца отчёта уходит в текст сообщения.
    const autoClosed = event.data?.autoClosed === true;

    await recordAuditEvent({
      action: event.type,
      scope: 'reports',
      actorId: autoClosed ? null : event.userId,
      targetId: event.aggregateId,
      tenantId: event.tenantId,
      requestId: event.metadata?.requestId as string,
      metadata: {
        eventType: event.type,
        aggregateType: event.aggregateType,
        version: event.version,
        data: event.data,
        ...(autoClosed ? { operatorName: await reportOwnerName(event) } : {}),
      },
    });
  } catch (error) {
    logger.error('Audit event recording failed', error, {
      eventType: event.type,
      aggregateId: event.aggregateId,
    });
  }
}

/**
 * Имя владельца отчёта для текста автосдачи. Имя — украшение записи: сбой его
 * чтения не повод терять событие, поэтому здесь глушится только он. Запрос
 * тенантный (строгое равенство по организации события), чтобы имя не приехало
 * из чужой организации.
 */
async function reportOwnerName(event: ReportDomainEvent): Promise<string | null> {
  if (!event.userId) return null;

  try {
    const user = await db.user.findFirst({
      where: event.tenantId
        ? { id: event.userId, tenantId: event.tenantId }
        : { id: event.userId },
      select: { name: true },
    });
    return user?.name ?? null;
  } catch (error) {
    logger.warn('audit.auto_submitted_owner_lookup_failed', {
      userId: event.userId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
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

/**
 * Тип события доставки PDF отчёта. Отправка идёт через outbox, как тревоги
 * (core/notifications/durable-alert): раньше PDF слался прямо из обработчика,
 * и сбой Telegram только писался в журнал — отчёт в чат больше не приходил.
 * Теперь сбой бросает исключение, outbox повторяет с паузами, а после
 * исчерпания попыток событие видно в DLQ.
 */
export const REPORT_PDF_DELIVERY_EVENT = 'ReportPdfDeliveryRequested';

async function handleReportSubmittedTelegram(event: ReportDomainEvent) {
  const { db } = await import('@/lib/db');
  try {
    // Признак «Новые отчёты и сводки» из настроек организации. Раньше PDF
    // уходил независимо от переключателя.
    const { isNotificationEnabled } = await import('@/modules/settings');
    if (!await isNotificationEnabled(event.tenantId, 'newReports')) {
      logger.info('Telegram report PDF suppressed by tenant settings', {
        reportId: event.aggregateId,
      });
      return;
    }

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

    // Одна доставка на одно событие ReportSubmitted: ключ не даёт поставить
    // её дважды, если это событие повторяется из-за сбоя соседнего обработчика.
    try {
      await db.outboxEvent.create({
        data: {
          type: REPORT_PDF_DELIVERY_EVENT,
          aggregateType: 'Notification',
          aggregateId: event.aggregateId,
          tenantId: event.tenantId ?? null,
          dedupeKey: `report-pdf:${event.id}`,
          payload: { autoClosed: event.data?.autoClosed === true },
          // Проекциям это событие не нужно.
          projected: true,
        },
      });
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') return;
      throw error;
    }
  } catch (error) {
    // Постановку в очередь не глотаем: иначе отчёт снова тихо не дойдёт.
    logger.error('Telegram report PDF: failed to enqueue delivery', error, {
      reportId: event.aggregateId,
    });
    throw error;
  }
}

const PILE_JOURNAL_URL = `${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://orionpiling.ru'}/admin/reports?view=piles`;

/** Доставка PDF отчёта в Telegram. Бросает при сбое — outbox повторит. */
export async function deliverReportPdf(event: { id?: string; aggregateId: string; data?: unknown }) {
  if (!event.id) throw new Error('Report PDF delivery requires the outbox event id');
  const { db } = await import('@/lib/db');
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
  const totalPileMeters = d.piles.reduce(
    (s, p) => s + (p.count || 0) * pileLengthMeters({ gradeLengthMm: p.pileGrade?.lengthMm }),
    0
  );
  const totalDrillingCount = d.drillings.reduce((s, x) => s + (x.count || 1), 0);
  const totalDrilling = d.drillings.reduce((s, x) => s + (x.meters || 0), 0);
  const totalDowntime = d.downtimes.reduce((s, x) => s + (x.duration || 0), 0);

  // Смену закрыл планировщик, а не оператор: «отчёт отправлен» от его имени
  // было бы неправдой (см. readiness/application/scheduler).
  const autoClosed = (event.data as { autoClosed?: unknown } | undefined)?.autoClosed === true;

  const lines = [
    autoClosed
      ? '⚠️ <b>Смена закрыта автоматически</b> — оператор её не закрыл'
      : isCorrection
        ? `✏️ <b>Корректировка отчёта</b> (ред. №${reportVersion})`
        : '📋 <b>Отчёт отправлен</b>',
    '',
    `📍 Объект: <b>${escapeHtml(d.site?.name || '—')}</b>`,
    `📅 Дата: <b>${escapeHtml(d.date)}</b>`,
    `👷 Оператор: <b>${escapeHtml(d.user?.name || '—')}</b>`,
    ...(isCorrection ? [`🖊 Изменил: <b>${escapeHtml(operatorName)}</b>`] : []),
    `🛠 Оборудование: ${escapeHtml(d.equipmentName || '—')}`,
    '',
    `🔩 Свай забито: <b>${formatCountMeters(totalPiles, totalPileMeters)}</b>`,
    `🌀 Бурение: <b>${formatCountMeters(totalDrillingCount, totalDrilling)}</b>`,
    `⏸ Простои: <b>${formatDowntimeHours(totalDowntime)}</b>`,
    ...(autoClosed
      ? ['', `Если запись пропущена, её вносит мастер: <a href="${PILE_JOURNAL_URL}">журнал забивки</a>`]
      : []),
  ];
  const caption = lines.join('\n');

  const pdfBuffer = await generateSinglePdf(d);
  const filename = `report-${d.date}-${transliterate(d.user?.name || 'unknown')}.pdf`.replace(/[^A-Za-z0-9._-]/g, '_');

  // Строку события блокируем на время отправки: outbox-публикатор крутится и в
  // app, и в workers, а Telegram ключей идемпотентности не знает. Кто пришёл
  // вторым, видит published=true и выходит.
  const complete = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "OutboxEvent" WHERE id = ${event.id} FOR UPDATE`;
    const row = await tx.outboxEvent.findUnique({ where: { id: event.id }, select: { published: true, payload: true } });
    if (!row || row.published) return true;
    const progress = createTelegramDeliveryProgress(row.payload, async (payload) => {
      await tx.outboxEvent.update({ where: { id: event.id }, data: { payload } });
    });
    const sent = await telegramNotifier.sendDocument(filename, pdfBuffer, caption, progress);
    // A partial batch must commit receipts before the outbox schedules retry.
    if (!sent) return false;
    await tx.outboxEvent.update({ where: { id: event.id }, data: { published: true, publishedAt: new Date(), lastError: null } });
    return true;
  }, { timeout: 60_000 });
  if (!complete) throw new Error('Telegram не принял PDF отчёта; событие останется на повтор');
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
