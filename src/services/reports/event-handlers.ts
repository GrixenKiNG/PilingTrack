import { createTelegramDeliveryProgress } from '@/core/notifications/telegram-delivery-progress';
import { SUBMITTED_REPORT_STATUS } from '@/lib/report-status';
/**
 * Event Handlers — Concrete handlers for domain events
 *
 * Each handler subscries to specific event types and performs
 * side effects: analytics projections, audit logs, alerts, notifications.
 *
 * These are registered once on server startup.
 */

// eslint-disable-next-line no-restricted-imports -- legacy cross-layer import pending the parked services<->modules migration (CLAUDE.md); behavior-neutral
import { ReportDomainEvent, REPORT_DOMAIN_EVENT_TYPES } from '@/modules/reports/domain';
import { on } from '@/services/reports/domain-events';
import { logger } from '@/lib/logger';
import { formatCountMeters } from '@/lib/format';
import { formatDowntimeHours } from '@/lib/downtime-hours';
import { pileLengthMeters } from '@/lib/pile-length';
import { getRedisClient } from '@/lib/redis-cache';
// Статически (в отличие от обработчиков ниже): динамический import этого
// модуля не подменяется моком в юнит-тесте, и путь «тенант из отчёта» иначе
// уходил бы в живую базу из теста. Прод-поведение то же — db это ленивый прокси.
import { db } from '@/lib/db';

// ============================================================
// Analytics Projection Handler
// ============================================================

export function registerAnalyticsEventHandler() {
  on(REPORT_DOMAIN_EVENT_TYPES.REPORT_CREATED, handleReportForAnalytics);
  on(REPORT_DOMAIN_EVENT_TYPES.REPORT_SUBMITTED, handleReportForAnalytics);
  // J4: правка отчёта тоже должна обновлять статус проекции. Без этого статус
  // меняли только ReportCreated (draft) и ReportSubmitted (submitted):
  // потерянный ReportSubmitted оставлял строку `draft` навсегда, хотя сам
  // Report уже `submitted` (наблюдалось на RM-3190cede). Обработчик берёт
  // статус из строки Report (источник истины), а не из типа события.
  on(REPORT_DOMAIN_EVENT_TYPES.REPORT_UPDATED, handleReportForAnalytics);
  // SiteDailySummary used to be maintained incrementally from item-level
  // events (PILE_WORK_ADDED / DRILLING_ADDED / DOWNTIME_ADDED). That had two
  // bugs: (1) `siteId || ''` fallback wrote rows with an empty key when an
  // event lacked siteId, and (2) reportCount was incremented per work item
  // instead of per report, so one report with 5 piles + 3 drillings counted
  // as 8 reports. Rebuilding from the Report row on REPORT_SUBMITTED /
  // REPORT_UPDATED is idempotent and matches scripts/backfill-projections.ts.
  on(REPORT_DOMAIN_EVENT_TYPES.REPORT_SUBMITTED, handleReportForDailySummary);
  on(REPORT_DOMAIN_EVENT_TYPES.REPORT_UPDATED,   handleReportForDailySummary);
  // Сводка по объектам (/api/analytics/sites) кэшируется в Redis на 5 минут
  // под ключом организации. Без этого сброса дашборд показывал прежнюю
  // выработку, пока журнал и аналитика уже отдавали новую (F-R35-2).
  on(REPORT_DOMAIN_EVENT_TYPES.REPORT_SUBMITTED, handleReportForAnalyticsCacheInvalidation);
  on(REPORT_DOMAIN_EVENT_TYPES.REPORT_UPDATED,   handleReportForAnalyticsCacheInvalidation);
  on(REPORT_DOMAIN_EVENT_TYPES.REPORT_DELETED,   handleReportForAnalyticsCacheInvalidation);
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
    // Older emit sites sometimes lacked siteId/userId/tenantId; the Report
    // lookup by reportId fills the gaps. The row is read unconditionally now
    // (J4) because it also carries the source-of-truth status.
    // J4: строку отчёта читаем ВСЕГДА — status проекции обязан отражать
    // ТЕКУЩИЙ статус источника, а не тип события. Заодно закрываем прежний
    // фолбэк недостающих siteId/userId/tenantId. События могут прийти не по
    // порядку, и без чтения источника `ReportUpdated` (или потерянный
    // `ReportSubmitted`) не мог подтянуть статус.
    const report = await db.report.findUnique({
      where: { reportId: event.aggregateId },
      select: { siteId: true, userId: true, tenantId: true, status: true },
    });
    const siteId = event.siteId || report?.siteId;
    const userId = event.userId || report?.userId;
    const tenantId = event.tenantId || report?.tenantId || undefined;
    // Организация обязательна. Строка проекции без неё невидима для тенантных
    // запросов (сломанная аналитика), а для запроса с пустым тенантом —
    // видна всем. Раньше здесь писался `tenantId || null`.
    //
    // J1: неразрешённые siteId/userId/tenantId — не «пропуск», а ошибка.
    // Молчаливый return означал тихую потерю: outbox-публикатор всё равно
    // клеймит строку `published=true` (dispatch-then-claim), ретрая и DLQ нет,
    // и проекции у события не будет уже никогда. Бросаем — outbox повторит, а
    // после исчерпания попыток отправит событие в dead-letter (механизм уже
    // есть в outbox-publisher.ts и здесь не меняется).
    if (!siteId || !userId || !tenantId) {
      const missing = [
        !siteId ? 'siteId' : null,
        !userId ? 'userId' : null,
        !tenantId ? 'tenantId' : null,
      ].filter(Boolean).join(', ');
      throw new Error(
        `ReportAnalytics projection: не удалось определить ${missing} для события ${event.type} (aggregateId=${event.aggregateId})`,
      );
    }

    // Статус — из источника: ReportAnalytics.status зеркалит Report.status
    // (то же правило, что и в rebuild.ts). Если строки отчёта нет, а событие
    // само несёт идентификаторы, сохраняем ПРЕЖНЕЕ поведение (статус по типу
    // события): отдельной правки W41 под этот крайний случай в ветке нет,
    // менять его не поручено.
    const status =
      report?.status ||
      (event.type === REPORT_DOMAIN_EVENT_TYPES.REPORT_SUBMITTED ? 'submitted' : 'draft');

    await db.reportAnalytics.upsert({
      where: { reportId: event.aggregateId },
      create: {
        reportId: event.aggregateId,
        siteId,
        userId,
        tenantId,
        status,
        totalPiles: (event.data.totalPiles as number) || 0,
        totalDrilling: (event.data.totalDrilling as number) || 0,
        totalDowntime: (event.data.totalDowntime as number) || 0,
        lastEventAt: new Date(event.occurredAt),
      },
      update: {
        status,
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
 * Сброс кэша сводки по объектам (`/api/analytics/sites`) после правки отчёта.
 *
 * До этого сводку не сбрасывала ни одна мутация отчёта: дашборд отдавал
 * прежнюю выработку до истечения TTL (5 мин), пока журнал и `/admin/analytics`
 * уже показывали новую, — при сверке это выглядело потерей данных (F-R35-2).
 *
 * Тенант берём из события, а при его отсутствии — из самого отчёта, как это
 * делает проекция выше. Сброс кэша — побочный эффект, а не критичная
 * проекция: и неразрешённый тенант, и недоступный Redis логируются, но
 * событие не валят (иначе outbox ушёл бы в ретрай/DLQ из-за кэша).
 */
async function handleReportForAnalyticsCacheInvalidation(event: ReportDomainEvent) {
  try {
    let tenantId = event.tenantId;
    if (!tenantId) {
      const report = await db.report.findUnique({
        where: { reportId: event.aggregateId },
        select: { tenantId: true },
      });
      tenantId = report?.tenantId || undefined;
    }
    if (!tenantId) {
      logger.warn('Site analytics cache not invalidated: cannot resolve tenantId', {
        eventType: event.type, aggregateId: event.aggregateId,
      });
      return;
    }

    const { invalidateSiteAnalytics } = await import('@/lib/cached-queries');
    await invalidateSiteAnalytics(tenantId);
  } catch (error) {
    // Сброс кэша — побочный эффект, а не критичная проекция: событие не
    // должно уходить в ретрай/DLQ из-за недоступного Redis.
    logger.warn('Site analytics cache invalidation failed', {
      eventType: event.type,
      aggregateId: event.aggregateId,
      error: error instanceof Error ? error.message : String(error),
    });
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
  // Только сданные: черновик идущей смены попадал в итог дня лишь тогда, когда
  // кто-то другой сдавал отчёт по тому же объекту, — и цифры дня плавали.
  const reports = await db.report.findMany({
    where: { siteId, date, status: SUBMITTED_REPORT_STATUS },
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
  // The transactional outbox stores only event.data as payload, dropping the
  // event-level siteId/date metadata — so when this handler runs off a
  // republished outbox event, both can be missing. Fall back to the Report
  // row, looked up by reportId: event.aggregateId IS Report.reportId (the
  // business key), NOT the primary-key `id`. The previous code both hard-
  // skipped on a missing siteId (losing every outbox-driven summary) and
  // queried by the wrong key (`id`), so the fallback never resolved.
  let siteId = event.siteId;
  let date = (event.data?.date as string | undefined) || null;
  if (!siteId || !date) {
    const { db } = await import('@/lib/db');
    const report = await db.report.findUnique({
      where: { reportId: event.aggregateId },
      select: { siteId: true, date: true },
    });
    siteId = siteId || report?.siteId;
    date = date || report?.date || null;
  }
  if (!siteId || !date) {
    logger.warn('SiteDailySummary skipped: cannot resolve siteId/date', {
      eventType: event.type, aggregateId: event.aggregateId,
    });
    return;
  }

  // Critical projection — propagate so outbox publisher can retry / DLQ.
  try {
    await recomputeSiteDailySummary(siteId, date);
  } catch (error) {
    logger.error('SiteDailySummary recompute failed', error, {
      eventType: event.type, aggregateId: event.aggregateId, siteId, date,
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

/** Окно дедупликации алерта о простое: правки отчёта идут в 24-часовом окне. */
const DOWNTIME_ALERT_TTL_SECONDS = 48 * 60 * 60;

/**
 * Ключ дедупликации алерта о простое (F-R33-2).
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

  // Дедупликация (F-R33-2): upsertReport пересобирает агрегат со ВСЕМИ
  // строками и `addDowntime` заново эмитит `DowntimeAdded` на каждую, поэтому
  // любое сохранение отчёта в окне правки слало диспетчеру повторный алерт о
  // том же простое — как будто простой новый.
  const alertKey = downtimeAlertKey(event);
  let redis: Awaited<ReturnType<typeof getRedisClient>> = null;
  if (alertKey) {
    try {
      redis = await getRedisClient();
      if (!redis) {
        // Нет Redis — шлём без дедупа: дубль лучше, чем молчание.
        logger.warn('Downtime alert: Redis unavailable, sending without dedupe', {
          reportId: event.aggregateId,
        });
      } else if (await redis.get(alertKey)) {
        logger.info('Downtime alert already sent for this downtime, skipping', {
          reportId: event.aggregateId, duration,
        });
        return;
      }
    } catch (err) {
      // Сбой Redis — тоже не повод молчать.
      logger.warn('Downtime alert: dedupe check failed, sending anyway', {
        reportId: event.aggregateId,
        error: err instanceof Error ? err.message : String(err),
      });
      redis = null;
    }
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
  if (event.tenantId) {
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
  }

  // Часовой пояс организации для строки времени: серверное время в алерте
  // отставало от московского на 3 часа (F-R33-1). Незнание зоны — не повод
  // молчать, поэтому при ошибке оставляем "Europe/Moscow".
  let timeZone = 'Europe/Moscow';
  if (event.tenantId) {
    try {
      const { getSettings } = await import('@/modules/settings');
      timeZone = (await getSettings(event.tenantId)).timezone || 'Europe/Moscow';
    } catch {
      // Настройки не прочитались — шлём в зоне по умолчанию.
    }
  }

  try {
    const { telegramNotifier } = await import('@/core/notifications/telegram');
    const sent = await telegramNotifier.sendAlert({
      severity: duration > 4 ? 'high' : 'medium',
      message: `Простой ${formatDowntimeHours(duration)} зафиксирован в отчёте`,
      siteId: event.siteId,
      siteName,
      reportId: event.aggregateId,
      reportNumber,
      timeZone,
    });
    // Ключ ставим только ПОСЛЕ успешной отправки: неудачная попытка должна
    // остаться возможной к повтору, а не глушиться собственным дедупом.
    if (redis && alertKey) {
      if (sent) {
        try {
          await redis.set(alertKey, '1', 'EX', DOWNTIME_ALERT_TTL_SECONDS);
        } catch (err) {
          logger.warn('Downtime alert: failed to set dedupe key', {
            reportId: event.aggregateId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      } else {
        logger.warn('Downtime alert not marked as sent: Telegram rejected it', {
          reportId: event.aggregateId, duration,
        });
      }
    }
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
  ];
  const caption = lines.join('\n');

  const pdfBuffer = await generateSinglePdf(d);
  const filename = `report-${d.date}-${d.user?.name || 'unknown'}.pdf`.replace(/[^A-Za-z0-9._-]/g, '_');

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
