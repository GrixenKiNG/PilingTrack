import { SUBMITTED_REPORT_STATUS } from '@/lib/report-status';
import { ReportDomainEvent, REPORT_DOMAIN_EVENT_TYPES } from '../domain';
import { on } from './domain-events';
import { logger } from '@/lib/logger';
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
  on(REPORT_DOMAIN_EVENT_TYPES.REPORT_DELETED,   handleReportDeleted);
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
      select: {
        siteId: true, userId: true, tenantId: true, status: true,
        piles: { select: { count: true } },
        drillings: { select: { meters: true } },
        downtimes: { select: { duration: true } },
      },
    });
    // W45: ReportUpdated для отчёта, которого уже нет в Report (отчёт удалён).
    // Событие само несёт siteId/userId/tenantId, и прежний код создавал по ним
    // строку ReportAnalytics для несуществующего отчёта — «сироту» (W12: 5
    // сирот локально; класс не само-лечится, см. rebuild.ts). Удаление отчёта —
    // нормальный конец его жизненного цикла: проекцию не пишем, но и НЕ бросаем
    // (бросок увёл бы событие в ретрай/DLQ без шанса на успех). Только для
    // ReportUpdated: для ReportCreated/ReportSubmitted поведение прежнее.
    if (!report && event.type === REPORT_DOMAIN_EVENT_TYPES.REPORT_UPDATED) {
      logger.info('Analytics projection skipped: report no longer exists', {
        eventType: event.type,
        aggregateId: event.aggregateId,
      });
      return;
    }
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

    // DF-02: числа — из текущих строк отчёта (как в rebuild.ts), а не из
    // события: повтор или ретрай старого события иначе возвращал бы прежние
    // итоги поверх новых. Из события — только когда строки отчёта нет вовсе.
    const totals = report
      ? {
          totalPiles: report.piles.reduce((sum, p) => sum + (p.count || 0), 0),
          totalDrilling: report.drillings.reduce((sum, d) => sum + (d.meters || 0), 0),
          totalDowntime: report.downtimes.reduce((sum, d) => sum + (d.duration || 0), 0),
        }
      : {
          totalPiles: (event.data.totalPiles as number) || 0,
          totalDrilling: (event.data.totalDrilling as number) || 0,
          totalDowntime: (event.data.totalDowntime as number) || 0,
        };

    await db.reportAnalytics.upsert({
      where: { reportId: event.aggregateId },
      create: {
        reportId: event.aggregateId,
        siteId,
        userId,
        tenantId,
        status,
        ...totals,
        lastEventAt: new Date(event.occurredAt),
      },
      update: {
        status,
        ...totals,
      },
    });
    // lastEventAt только вперёд: повтор старого события не откатывает метку.
    await db.reportAnalytics.updateMany({
      where: { reportId: event.aggregateId, lastEventAt: { lt: new Date(event.occurredAt) } },
      data: { lastEventAt: new Date(event.occurredAt) },
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
  // Чтение и запись — одна транзакция под замком на объект и день, взятым ДО
  // чтения (как у недельного тренда). Без замка пересчёт, прочитавший старые
  // отчёты, мог записаться после более нового и вернуть прежний итог дня.
  // Замок держится до коммита и сам снимается; именно `$executeRaw`, не
  // `$queryRaw` (pg_advisory_xact_lock возвращает void).
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`daily-summary:${siteId}:${date}`}))`;
    // Только сданные: черновик идущей смены попадал в итог дня лишь тогда, когда
    // кто-то другой сдавал отчёт по тому же объекту, — и цифры дня плавали.
    const reports = await tx.report.findMany({
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
      await tx.siteDailySummary.deleteMany({ where: { siteId, date } });
      return;
    }

    await tx.siteDailySummary.upsert({
      where: { siteId_date: { siteId, date } },
      create: { siteId, date, totalPiles, totalDrilling, totalDowntime, reportCount },
      update: { totalPiles, totalDrilling, totalDowntime, reportCount },
    });
  });
}

/**
 * ReportDeleted: убрать вклад удалённого отчёта из проекций.
 *
 * Маршрут удаления делает то же сразу после коммита, но «по возможности»;
 * упавший там пересчёт не повторялся. Здесь ошибка пробрасывается — outbox
 * повторит событие или отправит в DLQ. Идемпотентно. Отчёта в базе уже нет,
 * поэтому объект и дату берём из события (конверт и `data` несут их из снимка).
 */
async function handleReportDeleted(event: ReportDomainEvent) {
  const siteId = event.siteId || (event.data?.siteId as string | undefined);
  const date = event.data?.date as string | undefined;
  if (!siteId || !date) {
    throw new Error(
      `ReportDeleted: не удалось определить siteId/date для ${event.aggregateId}`,
    );
  }
  const { db } = await import('@/lib/db');
  await db.reportAnalytics.deleteMany({ where: { reportId: event.aggregateId } });
  await recomputeSiteDailySummary(siteId, date);
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
