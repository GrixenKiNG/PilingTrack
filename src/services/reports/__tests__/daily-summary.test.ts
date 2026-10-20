/**
 * recomputeSiteDailySummary — regression test for C-1.
 *
 * History (2026-04): SiteDailySummary used to be maintained incrementally
 * from item-level events (PILE_WORK_ADDED / DRILLING_ADDED / DOWNTIME_ADDED)
 * with two bugs:
 *   1. `siteId || ''` fallback wrote rows with empty key.
 *   2. reportCount += 1 on every work item — one report with 5 piles + 3
 *      drillings counted as 8 reports.
 *
 * Replaced with REPORT_SUBMITTED / REPORT_UPDATED → recompute aggregate
 * from db.report.findMany. These tests pin the new contract.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  findManyMock, upsertMock, deleteManyMock, findUniqueMock, analyticsUpsertMock, invalidateAnalyticsMock,
  outboxFindUnique, outboxUpdate, sendDocument, findFirstMock, isNotifMock, getSettingsMock, sendAlertMock,
  outboxCreate, userFindFirst, recordAuditEventMock, dbClient,
} = vi.hoisted(() => {
  const findManyMock = vi.fn();
  const upsertMock = vi.fn();
  const deleteManyMock = vi.fn();
  const findUniqueMock = vi.fn();
  const analyticsUpsertMock = vi.fn();
  const invalidateAnalyticsMock = vi.fn();
  const outboxFindUnique = vi.fn();
  const outboxUpdate = vi.fn();
  const sendDocument = vi.fn();
  const findFirstMock = vi.fn();
  const isNotifMock = vi.fn();
  const getSettingsMock = vi.fn();
  const sendAlertMock = vi.fn();
  const outboxCreate = vi.fn();
  const userFindFirst = vi.fn();
  const recordAuditEventMock = vi.fn();

  const client = {
    report: { findMany: findManyMock, findUnique: findUniqueMock, findFirst: findFirstMock },
    user: { findFirst: userFindFirst },
    siteDailySummary: { upsert: upsertMock, deleteMany: deleteManyMock },
    reportAnalytics: { upsert: analyticsUpsertMock },
    outboxEvent: { findUnique: outboxFindUnique, update: outboxUpdate, create: outboxCreate },
    $queryRaw: vi.fn(),
    $transaction: (fn: (tx: unknown) => unknown) => fn(client),
  };

  return {
    findManyMock, upsertMock, deleteManyMock, findUniqueMock, analyticsUpsertMock, invalidateAnalyticsMock,
    outboxFindUnique, outboxUpdate, sendDocument, findFirstMock, isNotifMock, getSettingsMock, sendAlertMock,
    outboxCreate, userFindFirst, recordAuditEventMock, dbClient: client,
  };
});

vi.mock('@/lib/db', () => ({ db: dbClient }));

// Обработчики подписаны на события и берут db динамическим `await import(...)`,
// а emitDomainEvent запускает их разом (Promise.allSettled). Vitest не подменяет
// один и тот же модуль, когда его одновременно импортируют несколько
// обработчиков: второй импорт уходит в настоящий `@/lib/db` и до живого
// подключения к базе. Кладём тот же клиент в кэш Prisma (`globalThis.prisma`),
// которым пользуется настоящий модуль, — тогда ни один путь не идёт в БД.
beforeEach(() => {
  (globalThis as unknown as { prisma?: unknown }).prisma = dbClient;
});

// След в ленте пишет audit-service; здесь проверяется контракт обработчика —
// каким актором и с каким именем оператора событие уезжает в запись.
vi.mock('@/services/audit/audit-service', () => ({
  recordAuditEvent: recordAuditEventMock,
}));

vi.mock('@/lib/pdf-data', () => ({
  loadSingleReportPdfContext: vi.fn().mockResolvedValue({
    report: { version: 1 },
    pdfData: {
      date: '2026-09-25',
      user: { name: 'Иванов' },
      site: { name: 'Объект' },
      piles: [{ pileGrade: { name: 'С300', lengthMm: 12000 }, count: 2 }],
      drillings: [{ type: { name: 'Лидерное' }, count: 3, meters: 36 }],
      downtimes: [],
    },
  }),
}));
vi.mock('@/lib/pdf-generator', () => ({ generateSinglePdf: vi.fn().mockResolvedValue(Buffer.from('pdf')) }));
vi.mock('@/core/notifications/telegram', () => ({
  telegramNotifier: { sendDocument, sendAlert: sendAlertMock },
}));

vi.mock('@/modules/settings', () => ({
  isNotificationEnabled: isNotifMock,
  getSettings: getSettingsMock,
}));

vi.mock('@/lib/cached-queries', () => ({
  invalidateSiteAnalytics: invalidateAnalyticsMock,
}));

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import {
  recomputeSiteDailySummary, deliverReportPdf, registerAnalyticsEventHandler, registerAlertEventHandler,
  registerAuditEventHandler,
} from '../event-handlers';
import { emitDomainEvent } from '@/services/reports/domain-events';
import { REPORT_DOMAIN_EVENT_TYPES } from '@/modules/reports/domain';
import { logger } from '@/lib/logger';

// Доставка PDF отчёта в Telegram (R9-1): сбой должен оставлять событие на
// повтор, а не теряться в журнале, и повтор не должен слать PDF второй раз.
describe('deliverReportPdf', () => {
  beforeEach(() => {
    outboxFindUnique.mockReset();
    outboxUpdate.mockReset();
    sendDocument.mockReset();
  });

  it('Telegram не принял — бросает и не отмечает событие доставленным', async () => {
    outboxFindUnique.mockResolvedValue({ published: false });
    sendDocument.mockResolvedValue(false);

    await expect(deliverReportPdf({ id: 'ev-1', aggregateId: 'r-1' })).rejects.toThrow();
    expect(outboxUpdate).not.toHaveBeenCalled();
  });

  // F10: кириллица в имени файла транслитерируется, а не превращается в «_».
  it('имя PDF в Telegram — латиница, ФИО транслитерировано (F10)', async () => {
    outboxFindUnique.mockResolvedValue({ published: false });
    sendDocument.mockResolvedValue(true);

    await deliverReportPdf({ id: 'ev-name', aggregateId: 'r-name' });

    expect(sendDocument.mock.calls[0][0]).toMatch(/^report-[\d-]+-Ivanov\.pdf$/);
  });

  it('уже доставленное событие повторно не отправляется', async () => {
    outboxFindUnique.mockResolvedValue({ published: true });

    await deliverReportPdf({ id: 'ev-1', aggregateId: 'r-1' });
    expect(sendDocument).not.toHaveBeenCalled();
  });

  // F-R51-FORMAT: и сваи, и бурение в подписи — «N шт. / M м.п.», а не
  // голые метры бурения и голые штуки свай (решение владельца 28.09).
  it('подпись Telegram печатает сваи и бурение как «шт. / м.п.» (F-R51-FORMAT)', async () => {
    outboxFindUnique.mockResolvedValue({ published: false });
    sendDocument.mockResolvedValue(true);

    await deliverReportPdf({ id: 'ev-fmt', aggregateId: 'r-fmt' });

    const caption = sendDocument.mock.calls[0][2] as string;
    const lines = caption.split('\n');
    const pilesLine = lines.find((line) => line.includes('Свай забито')) ?? '';
    const drillingLine = lines.find((line) => line.includes('Бурение')) ?? '';
    for (const line of [pilesLine, drillingLine]) {
      expect(line).toContain('шт. / ');
      expect(line).toContain('м.п.');
    }
    // 2 сваи × 12 м = 24 м.п.; 3 бурения = 36 м.п.
    expect(pilesLine).toContain('2 шт. / 24 м.п.');
    expect(drillingLine).toContain('3 шт. / 36 м.п.');
  });
});

describe('handleReportForAnalytics', () => {
  beforeEach(() => {
    findManyMock.mockReset();
    upsertMock.mockReset();
    deleteManyMock.mockReset();
    findUniqueMock.mockReset();
    analyticsUpsertMock.mockReset();
    invalidateAnalyticsMock.mockReset();
    findManyMock.mockResolvedValue([]);
    registerAnalyticsEventHandler();
  });

  it('writes the projection with the tenant of the event', async () => {
    await emitDomainEvent({
      id: 'evt-1',
      type: REPORT_DOMAIN_EVENT_TYPES.REPORT_SUBMITTED,
      aggregateId: 'report-uuid-1',
      aggregateType: 'Report',
      occurredAt: new Date().toISOString(),
      siteId: 'site_A',
      userId: 'user-1',
      tenantId: 'tenant-a',
      data: {},
    });

    expect(analyticsUpsertMock.mock.calls[0][0].create).toMatchObject({ tenantId: 'tenant-a' });
  });

  /*
    J1 (W28-CODEX-J-TESTPLAN): при неразрешимом siteId/userId/tenantId
    обработчик раньше молча `return`-ил, а outbox-publisher всё равно клеймил
    строку `published=true` (dispatch-then-claim) — ретрая и DLQ не было, и
    проекция терялась молча. Теперь неразрешённый идентификатор бросает, чтобы
    сработал ретрай/DLQ. Этот тест стоял на молчаливом пропуске — переписан.
  */
  it('бросает, когда организацию определить нечем (ретрай/DLQ, а не тихий пропуск)', async () => {
    findUniqueMock.mockResolvedValue({ siteId: 'site_A', userId: 'user-1', tenantId: null });

    await expect(
      emitDomainEvent({
        id: 'evt-2',
        type: REPORT_DOMAIN_EVENT_TYPES.REPORT_SUBMITTED,
        aggregateId: 'report-uuid-2',
        aggregateType: 'Report',
        occurredAt: new Date().toISOString(),
        siteId: 'site_A',
        userId: 'user-1',
        data: {},
      }),
    ).rejects.toThrow();

    expect(analyticsUpsertMock).not.toHaveBeenCalled();
  });

  /*
    J1 (W28-CODEX-J-TESTPLAN): при неразрешимом siteId/userId/tenantId обработчик
    теперь бросает, а outbox-publisher повторит и при исчерпании попыток отправит
    событие в dead-letter. До правки тест фиксировал тихий успех.
  */
  it('J1: неразрешимый tenant бросает, проекция не пишется', async () => {
    findUniqueMock.mockResolvedValue({ siteId: 'site_A', userId: 'user-1', tenantId: null });

    await expect(
      emitDomainEvent({
        id: 'evt-j1-1',
        type: REPORT_DOMAIN_EVENT_TYPES.REPORT_SUBMITTED,
        aggregateId: 'report-uuid-j1',
        aggregateType: 'Report',
        occurredAt: new Date().toISOString(),
        siteId: 'site_A',
        userId: 'user-1',
        data: {},
      }),
    ).rejects.toThrow();

    expect(analyticsUpsertMock).not.toHaveBeenCalled();
  });

  /*
    J4 (W28-CODEX-J-TESTPLAN): на ReportUpdated аналитика раньше не подписана, поэтому
    статус проекции меняли лишь ReportCreated/ReportSubmitted. Если ReportSubmitted
    не дошёл (J1/J2), строка ReportAnalytics навсегда остаётся `draft` при живом
    Report.status = submitted (наблюдалось на RM-3190cede). Теперь ReportUpdated
    зеркалит статус отчёта в проекцию (источник — строка Report).
  */
  it('J4: ReportUpdated зеркалит статус отчёта в проекцию', async () => {
    findUniqueMock.mockResolvedValue({
      siteId: 'site_A', userId: 'user-1', tenantId: 'tenant-a', status: 'submitted',
    });

    await emitDomainEvent({
      id: 'evt-j4-1',
      type: REPORT_DOMAIN_EVENT_TYPES.REPORT_UPDATED,
      aggregateId: 'report-uuid-j4',
      aggregateType: 'Report',
      occurredAt: new Date().toISOString(),
      siteId: 'site_A',
      userId: 'user-1',
      tenantId: 'tenant-a',
      data: {},
    });

    expect(analyticsUpsertMock).toHaveBeenCalled();
    expect(analyticsUpsertMock.mock.calls[0][0].update.status).toBe('submitted');
  });

  /*
    W45 (W45-REPORTUPDATED-DELETED): ReportUpdated приходит для отчёта, которого
    уже нет в Report (отчёт удалён), но событие само несёт siteId/userId/tenantId.
    Прежний обработчик писал по ним строку ReportAnalytics для несуществующего
    отчёта — «сироту» (W12: 5 сирот локально). Удаление отчёта — нормальный
    конец: проекцию не пишем и НЕ бросаем (бросок увёл бы событие в ретрай/DLQ).
  */
  it('W45: ReportUpdated для удалённого отчёта не пишет проекцию и не бросает', async () => {
    findUniqueMock.mockResolvedValue(null);

    await expect(emitDomainEvent({
      id: 'evt-w45-1',
      type: REPORT_DOMAIN_EVENT_TYPES.REPORT_UPDATED,
      aggregateId: 'report-deleted-1',
      aggregateType: 'Report',
      occurredAt: new Date().toISOString(),
      siteId: 'site_A',
      userId: 'user-1',
      tenantId: 'tenant-a',
      data: {},
    })).resolves.toBeUndefined();

    expect(analyticsUpsertMock).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      'Analytics projection skipped: report no longer exists',
      { eventType: REPORT_DOMAIN_EVENT_TYPES.REPORT_UPDATED, aggregateId: 'report-deleted-1' },
    );
  });

  /*
    W45: правка касается ТОЛЬКО ReportUpdated. Для ReportCreated (/ReportSubmitted)
    без строки отчёта, но с идентификаторами в событии, поведение прежнее —
    строка проекции создаётся (её ещё нечем подтвердить, но и не повод молчать).
  */
  it('W45: ReportCreated без строки отчёта сохраняет прежнее поведение', async () => {
    findUniqueMock.mockResolvedValue(null);

    await emitDomainEvent({
      id: 'evt-w45-2',
      type: REPORT_DOMAIN_EVENT_TYPES.REPORT_CREATED,
      aggregateId: 'report-new-1',
      aggregateType: 'Report',
      occurredAt: new Date().toISOString(),
      siteId: 'site_A',
      userId: 'user-1',
      tenantId: 'tenant-a',
      data: {},
    });

    expect(analyticsUpsertMock).toHaveBeenCalledTimes(1);
    expect(analyticsUpsertMock.mock.calls[0][0].create).toMatchObject({
      reportId: 'report-new-1', tenantId: 'tenant-a', status: 'draft',
    });
  });
});

describe('recomputeSiteDailySummary', () => {
  beforeEach(() => {
    findManyMock.mockReset();
    upsertMock.mockReset();
    deleteManyMock.mockReset();
    findUniqueMock.mockReset();
    analyticsUpsertMock.mockReset();
  });

  it('aggregates totals across ALL reports for a (siteId, date) pair', async () => {
    findManyMock.mockResolvedValue([
      {
        piles: [{ count: 10 }, { count: 5 }],
        drillings: [{ meters: 100 }],
        downtimes: [{ duration: 30 }],
      },
      {
        piles: [{ count: 3 }],
        drillings: [{ meters: 50 }, { meters: 25 }],
        downtimes: [],
      },
    ]);

    await recomputeSiteDailySummary('site_A', '2026-04-30');

    expect(upsertMock).toHaveBeenCalledTimes(1);
    const args = upsertMock.mock.calls[0][0];
    expect(args.where).toEqual({ siteId_date: { siteId: 'site_A', date: '2026-04-30' } });
    // 10 + 5 + 3 = 18 piles, 100 + 50 + 25 = 175 m drilling, 30 m downtime,
    // and reportCount = 2 (NOT 8 — the bug it replaces)
    expect(args.create).toMatchObject({
      siteId: 'site_A', date: '2026-04-30',
      totalPiles: 18, totalDrilling: 175, totalDowntime: 30, reportCount: 2,
    });
    expect(args.update).toMatchObject({
      totalPiles: 18, totalDrilling: 175, totalDowntime: 30, reportCount: 2,
    });
  });

  it('deletes the row when no reports remain for that (siteId, date)', async () => {
    // Last report on the day was deleted — phantom zero rows would clutter
    // the admin daily chart, so wipe the row instead.
    findManyMock.mockResolvedValue([]);

    await recomputeSiteDailySummary('site_A', '2026-04-30');

    expect(upsertMock).not.toHaveBeenCalled();
    expect(deleteManyMock).toHaveBeenCalledWith({
      where: { siteId: 'site_A', date: '2026-04-30' },
    });
  });

  it('handles reports with empty piles/drillings/downtimes arrays', async () => {
    findManyMock.mockResolvedValue([{ piles: [], drillings: [], downtimes: [] }]);

    await recomputeSiteDailySummary('site_A', '2026-04-30');

    const args = upsertMock.mock.calls[0][0];
    expect(args.create).toMatchObject({
      totalPiles: 0, totalDrilling: 0, totalDowntime: 0, reportCount: 1,
    });
  });
});

/*
  Сводка по объектам (/api/analytics/sites) кэшируется в Redis на 5 минут
  ключом организации и до этого не сбрасывалась ни одной мутацией отчёта:
  дашборд отставал от журнала (F-R35-2). Сброс — побочный эффект, он не
  должен валить событие (иначе outbox ушёл бы в ретрай/DLQ).
*/
describe('сброс кэша сводки по объектам (F-R35-2)', () => {
  beforeEach(() => {
    findManyMock.mockReset();
    findUniqueMock.mockReset();
    invalidateAnalyticsMock.mockReset();
    findManyMock.mockResolvedValue([]);
    registerAnalyticsEventHandler();
  });

  it('сбрасывает сводку организации из события', async () => {
    await emitDomainEvent({
      id: 'evt-cache-1',
      type: REPORT_DOMAIN_EVENT_TYPES.REPORT_SUBMITTED,
      aggregateId: 'report-uuid-1',
      aggregateType: 'Report',
      occurredAt: new Date().toISOString(),
      siteId: 'site_A',
      userId: 'user-1',
      tenantId: 'tenant-a',
      data: { date: '2026-04-30' },
    });

    expect(invalidateAnalyticsMock).toHaveBeenCalledWith('tenant-a');
  });

  it('сбрасывает сводку и после правки, и после удаления отчёта', async () => {
    for (const type of [
      REPORT_DOMAIN_EVENT_TYPES.REPORT_UPDATED,
      REPORT_DOMAIN_EVENT_TYPES.REPORT_DELETED,
    ]) {
      invalidateAnalyticsMock.mockClear();
      await emitDomainEvent({
        id: `evt-${type}`,
        type,
        aggregateId: 'report-uuid-1',
        aggregateType: 'Report',
        occurredAt: new Date().toISOString(),
        siteId: 'site_A',
        userId: 'user-1',
        tenantId: 'tenant-a',
        data: { date: '2026-04-30' },
      });

      expect(invalidateAnalyticsMock).toHaveBeenCalledWith('tenant-a');
    }
  });

  it('берёт организацию из отчёта, когда её нет в событии', async () => {
    findUniqueMock.mockResolvedValue({ tenantId: 'tenant-a' });

    await emitDomainEvent({
      id: 'evt-cache-3',
      type: REPORT_DOMAIN_EVENT_TYPES.REPORT_UPDATED,
      aggregateId: 'report-uuid-3',
      aggregateType: 'Report',
      occurredAt: new Date().toISOString(),
      siteId: 'site_A',
      userId: 'user-1',
      data: { date: '2026-04-30' },
    });

    expect(findUniqueMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { reportId: 'report-uuid-3' },
    }));
    expect(invalidateAnalyticsMock).toHaveBeenCalledWith('tenant-a');
  });

  it('не валит событие, если сброс кэша упал', async () => {
    invalidateAnalyticsMock.mockRejectedValue(new Error('redis down'));

    await expect(emitDomainEvent({
      id: 'evt-cache-4',
      type: REPORT_DOMAIN_EVENT_TYPES.REPORT_SUBMITTED,
      aggregateId: 'report-uuid-4',
      aggregateType: 'Report',
      occurredAt: new Date().toISOString(),
      siteId: 'site_A',
      userId: 'user-1',
      tenantId: 'tenant-a',
      data: { date: '2026-04-30' },
    })).resolves.toBeUndefined();
  });
});

/*
  F-R33-1: алерт о простое уходил диспетчеру сырым числом часов
  («Простой 2.3333333333333335 ч») и внутренними id вместо названия объекта и
  номера отчёта. Обработчик обязан подтянуть их одним тенантным запросом
  (строгое равенство по организации события) и передать зону из настроек.

  F7-хвост: сам Telegram-вызов (до 5 с на отправку) не должен идти в общей
  полосе публикатора outbox. Обработчик только ставит алерт в очередь
  NotificationDeliveryRequested (её разбирает полоса Telegram); отправку и
  дедуп по Redis делает durable-alert-delivery (см. его тесты).
*/
describe('алерт о простое: постановка в очередь (F-R33-1, F7)', () => {
  beforeEach(() => {
    findFirstMock.mockReset();
    sendAlertMock.mockReset();
    isNotifMock.mockReset();
    getSettingsMock.mockReset();
    outboxCreate.mockReset();
    findFirstMock.mockResolvedValue(null);
    isNotifMock.mockResolvedValue(true);
    getSettingsMock.mockResolvedValue({ timezone: 'Asia/Krasnoyarsk' });
    registerAlertEventHandler();
  });

  function downtimeEvent(overrides: { data?: Record<string, unknown>; tenantId?: string | null } = {}) {
    return {
      id: 'evt-dt-1',
      type: REPORT_DOMAIN_EVENT_TYPES.DOWNTIME_ADDED,
      aggregateId: 'RM-abcd1234-2026-09-26',
      aggregateType: 'Report' as const,
      occurredAt: new Date().toISOString(),
      siteId: 'clx-site-cuid',
      userId: 'user-1',
      tenantId: overrides.tenantId === null ? undefined : (overrides.tenantId ?? 'tenant-a'),
      data: { reasonId: 'reason-1', duration: 2.3333333333333335, ...overrides.data },
    };
  }

  it('кладёт в очередь название объекта, номер отчёта, зону тенанта и ключ дедупа', async () => {
    findFirstMock.mockResolvedValue({
      reportId: 'RM-abcd1234-2026-09-26',
      site: { name: 'Северный' },
    });

    await emitDomainEvent(downtimeEvent());

    expect(findFirstMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { reportId: 'RM-abcd1234-2026-09-26', tenantId: 'tenant-a' },
    }));
    expect(outboxCreate).toHaveBeenCalledTimes(1);
    expect(outboxCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      type: 'NotificationDeliveryRequested',
      tenantId: 'tenant-a',
      aggregateId: 'RM-abcd1234-2026-09-26',
      payload: expect.objectContaining({
        severity: 'medium',
        message: 'Простой 2 ч 20 мин зафиксирован в отчёте',
        siteId: 'clx-site-cuid',
        reportId: 'RM-abcd1234-2026-09-26',
        siteName: 'Северный',
        reportNumber: 'RM-abcd1234-2026-09-26',
        timeZone: 'Asia/Krasnoyarsk',
        notificationKey: 'downtime30',
        dedupeKey: 'alert:downtime:tenant-a:RM-abcd1234-2026-09-26:reason-1:2.3333333333333335',
      }),
    }) });
  });

  it('не зовёт Telegram из общей полосы: отправка уходит только в очередь', async () => {
    await emitDomainEvent(downtimeEvent());

    expect(sendAlertMock).not.toHaveBeenCalled();
    expect(outboxCreate).toHaveBeenCalledTimes(1);
  });

  it('падает обратно на строки с id, если отчёт не нашёлся', async () => {
    findFirstMock.mockResolvedValue(null);

    await emitDomainEvent(downtimeEvent());

    const payload = outboxCreate.mock.calls[0][0].data.payload;
    expect(payload.siteName).toBeUndefined();
    expect(payload.reportNumber).toBeUndefined();
    expect(payload.reportId).toBe('RM-abcd1234-2026-09-26');
  });

  it('больше 4 ч — severity high', async () => {
    await emitDomainEvent(downtimeEvent({ data: { duration: 5 } }));

    expect(outboxCreate.mock.calls[0][0].data.payload.severity).toBe('high');
  });

  it('до 2 ч включительно алерта нет', async () => {
    await emitDomainEvent(downtimeEvent({ data: { duration: 2 } }));

    expect(outboxCreate).not.toHaveBeenCalled();
  });

  it('выключенный в настройках признак «Простой» — в очередь не ставит', async () => {
    isNotifMock.mockResolvedValue(false);

    await emitDomainEvent(downtimeEvent());

    expect(isNotifMock).toHaveBeenCalledWith('tenant-a', 'downtime30');
    expect(outboxCreate).not.toHaveBeenCalled();
  });

  it('без организации в событии очередь не трогает (fail closed)', async () => {
    await emitDomainEvent(downtimeEvent({ tenantId: null }));

    expect(outboxCreate).not.toHaveBeenCalled();
  });

  it('другая организация или другая длительность — свой ключ дедупа', async () => {
    await emitDomainEvent(downtimeEvent());
    await emitDomainEvent(downtimeEvent({ tenantId: 'tenant-b' }));
    await emitDomainEvent(downtimeEvent({ data: { duration: 5 } }));

    const keys = outboxCreate.mock.calls.map(c => c[0].data.payload.dedupeKey);
    expect(new Set(keys).size).toBe(3);
  });

  it('сбой постановки в очередь уходит на повтор outbox, а не глотается: алерт не теряется', async () => {
    outboxCreate.mockRejectedValueOnce(new Error('db down'));

    await expect(emitDomainEvent(downtimeEvent())).rejects.toThrow('db down');
  });
});

/*
  F-R34-18: черновик сменного отчёта сдаёт планировщик, когда производственные
  сутки истекли, — оператор отчёт не сдавал. Запись в ленте от его имени была
  неправдой: у автосдачи актора нет («система»), а имя владельца отчёта уходит
  в текст сообщения. Признак autoClosed кладёт в payload планировщик
  (readiness/scheduler), здесь его только читают.
*/
describe('аудит автосдачи отчёта планировщиком (F-R34-18)', () => {
  beforeEach(() => {
    recordAuditEventMock.mockReset();
    recordAuditEventMock.mockResolvedValue(undefined);
    userFindFirst.mockReset();
    userFindFirst.mockResolvedValue({ name: 'Петров И.И.' });
    registerAuditEventHandler();
  });

  function submittedEvent(data: Record<string, unknown>) {
    return {
      id: 'evt-audit-1',
      type: REPORT_DOMAIN_EVENT_TYPES.REPORT_SUBMITTED,
      aggregateId: 'RM-abcd1234-2026-09-26',
      aggregateType: 'Report' as const,
      occurredAt: new Date().toISOString(),
      siteId: 'site-1',
      userId: 'op-1',
      tenantId: 'tenant-a',
      data,
    };
  }

  it('пишет след без актора и передаёт имя оператора', async () => {
    await emitDomainEvent(submittedEvent({ autoClosed: true }));

    expect(recordAuditEventMock).toHaveBeenCalledWith(expect.objectContaining({
      action: REPORT_DOMAIN_EVENT_TYPES.REPORT_SUBMITTED,
      actorId: null,
      targetId: 'RM-abcd1234-2026-09-26',
      tenantId: 'tenant-a',
      metadata: expect.objectContaining({
        data: expect.objectContaining({ autoClosed: true }),
        operatorName: 'Петров И.И.',
      }),
    }));
    // Имя читается тенантным запросом — не из чужой организации.
    expect(userFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'op-1', tenantId: 'tenant-a' },
    }));
  });

  it('обычную сдачу оставляет за оператором', async () => {
    await emitDomainEvent(submittedEvent({}));

    expect(recordAuditEventMock).toHaveBeenCalledWith(expect.objectContaining({
      actorId: 'op-1',
      metadata: expect.objectContaining({ data: {} }),
    }));
    expect(userFindFirst).not.toHaveBeenCalled();
  });

  // Имя — украшение записи: сбой чтения не повод терять след.
  it('пишет след, если имя оператора прочитать не удалось', async () => {
    userFindFirst.mockRejectedValue(new Error('db down'));

    await emitDomainEvent(submittedEvent({ autoClosed: true }));

    expect(recordAuditEventMock).toHaveBeenCalledWith(expect.objectContaining({
      actorId: null,
      metadata: expect.objectContaining({ operatorName: null }),
    }));
  });
});

it('I05: daily projection is unchanged by draft work and changes after submission', async () => {
  const report = { status: 'draft', piles: [{ count: 2 }], drillings: [{ meters: 18 }], downtimes: [{ duration: 1.5 }] };
  findManyMock.mockReset().mockImplementation(async ({ where }) => report.status === where.status ? [report] : []);
  upsertMock.mockReset(); deleteManyMock.mockReset();
  await recomputeSiteDailySummary('site_A', '2026-10-02');
  expect(upsertMock).not.toHaveBeenCalled();
  expect(deleteManyMock).toHaveBeenCalledTimes(1);
  report.status = 'submitted';
  await recomputeSiteDailySummary('site_A', '2026-10-02');
  expect(upsertMock.mock.calls[0][0].create).toMatchObject({ reportCount: 1, totalPiles: 2, totalDrilling: 18, totalDowntime: 1.5 });
});
it('I08: partial PDF batch retains per-chat receipts before a retry', async () => {
  let row = { published: false, payload: { autoClosed: true } };
  outboxFindUnique.mockReset().mockImplementation(async () => row);
  outboxUpdate.mockReset().mockImplementation(async ({ data }) => { row = { ...row, ...data }; });
  sendDocument.mockReset().mockImplementationOnce(async (_file, _data, _caption, progress) => { await progress.confirm('A'); return false; });
  await expect(deliverReportPdf({ id: 'partial-pdf', aggregateId: 'r1' })).rejects.toThrow();
  expect(row.published).toBe(false);
  expect(row.payload).toMatchObject({ autoClosed: true, telegramDeliveredChatIds: ['A'] });
  sendDocument.mockImplementationOnce(async (_file, _data, _caption, progress) => {
    expect([...progress.deliveredChatIds]).toEqual(['A']);
    await progress.confirm('B'); return true;
  });
  await deliverReportPdf({ id: 'partial-pdf', aggregateId: 'r1' });
  expect(row.published).toBe(true);
  expect(row.payload).toMatchObject({ telegramDeliveredChatIds: ['A', 'B'] });
});

describe('PDF автозакрытой смены: ссылка на журнал забивки', () => {
  async function captionOf(data?: Record<string, unknown>) {
    outboxFindUnique.mockReset().mockResolvedValue({ published: false, payload: {} });
    outboxUpdate.mockReset().mockResolvedValue(undefined);
    sendDocument.mockReset().mockResolvedValue(true);
    await deliverReportPdf({ id: 'evt-caption', aggregateId: 'r1', data });
    return sendDocument.mock.calls[0][2] as string;
  }

  it('подпись автозакрытия ведёт в журнал забивки', async () => {
    const caption = await captionOf({ autoClosed: true });

    expect(caption).toContain('Смена закрыта автоматически');
    expect(caption).toContain('href="https://orionpiling.ru/admin/reports?view=piles"');
    expect(caption).toContain('журнал забивки');
  });

  it('обычная сдача ссылки не получает', async () => {
    const caption = await captionOf();

    expect(caption).not.toContain('view=piles');
  });
});
