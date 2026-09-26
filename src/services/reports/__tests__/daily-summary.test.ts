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
  redisGetClientMock, redisGetMock, redisSetMock,
} = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  upsertMock: vi.fn(),
  deleteManyMock: vi.fn(),
  findUniqueMock: vi.fn(),
  analyticsUpsertMock: vi.fn(),
  invalidateAnalyticsMock: vi.fn(),
  outboxFindUnique: vi.fn(),
  outboxUpdate: vi.fn(),
  sendDocument: vi.fn(),
  findFirstMock: vi.fn(),
  isNotifMock: vi.fn(),
  getSettingsMock: vi.fn(),
  sendAlertMock: vi.fn(),
  redisGetClientMock: vi.fn(),
  redisGetMock: vi.fn(),
  redisSetMock: vi.fn(),
}));

vi.mock('@/lib/db', () => {
  const client = {
    report: { findMany: findManyMock, findUnique: findUniqueMock, findFirst: findFirstMock },
    siteDailySummary: { upsert: upsertMock, deleteMany: deleteManyMock },
    reportAnalytics: { upsert: analyticsUpsertMock },
    outboxEvent: { findUnique: outboxFindUnique, update: outboxUpdate },
    $queryRaw: vi.fn(),
    $transaction: (fn: (tx: unknown) => unknown) => fn(client),
  };
  return { db: client };
});

vi.mock('@/lib/pdf-data', () => ({
  loadSingleReportPdfContext: vi.fn().mockResolvedValue({
    report: { version: 1 },
    pdfData: { date: '2026-09-25', user: { name: 'Иванов' }, site: { name: 'Объект' }, piles: [], drillings: [], downtimes: [] },
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

// Дедуп алертов о простое (F-R33-2) ходит в Redis: без мока тест либо тянул бы
// живую базу разработчика, либо ждал таймаут подключения.
vi.mock('@/lib/redis-cache', () => ({
  getRedisClient: redisGetClientMock,
}));

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import {
  recomputeSiteDailySummary, deliverReportPdf, registerAnalyticsEventHandler, registerAlertEventHandler,
} from '../event-handlers';
import { emitDomainEvent } from '@/services/reports/domain-events';
import { REPORT_DOMAIN_EVENT_TYPES } from '@/modules/reports/domain';

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

  it('уже доставленное событие повторно не отправляется', async () => {
    outboxFindUnique.mockResolvedValue({ published: true });

    await deliverReportPdf({ id: 'ev-1', aggregateId: 'r-1' });
    expect(sendDocument).not.toHaveBeenCalled();
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
    Проекция без организации раньше писалась с `tenantId: null`: строка
    становилась невидимой для всех тенантных запросов (сломанная аналитика),
    а для запроса с пустым тенантом — видна всем организациям. Запись без
    организации не создаём и сообщаем в лог, как для siteId/userId.
  */
  it('пропускает проекцию, когда организацию определить нечем', async () => {
    findUniqueMock.mockResolvedValue({ siteId: 'site_A', userId: 'user-1', tenantId: null });

    await emitDomainEvent({
      id: 'evt-2',
      type: REPORT_DOMAIN_EVENT_TYPES.REPORT_SUBMITTED,
      aggregateId: 'report-uuid-2',
      aggregateType: 'Report',
      occurredAt: new Date().toISOString(),
      siteId: 'site_A',
      userId: 'user-1',
      data: {},
    });

    expect(analyticsUpsertMock).not.toHaveBeenCalled();
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
*/
describe('алерт о простое (F-R33-1)', () => {
  beforeEach(() => {
    findFirstMock.mockReset();
    sendAlertMock.mockReset();
    isNotifMock.mockReset();
    getSettingsMock.mockReset();
    redisGetClientMock.mockReset();
    findFirstMock.mockResolvedValue(null);
    isNotifMock.mockResolvedValue(true);
    getSettingsMock.mockResolvedValue({ timezone: 'Asia/Krasnoyarsk' });
    // Redis недоступен → путь «шлём без дедупа»; сами алерты ниже про текст.
    redisGetClientMock.mockResolvedValue(null);
    registerAlertEventHandler();
  });

  function downtimeEvent() {
    return {
      id: 'evt-dt-1',
      type: REPORT_DOMAIN_EVENT_TYPES.DOWNTIME_ADDED,
      aggregateId: 'RM-abcd1234-2026-09-26',
      aggregateType: 'Report' as const,
      occurredAt: new Date().toISOString(),
      siteId: 'clx-site-cuid',
      userId: 'user-1',
      tenantId: 'tenant-a',
      data: { duration: 2.3333333333333335 },
    };
  }

  it('передаёт название объекта, номер отчёта и зону тенанта', async () => {
    findFirstMock.mockResolvedValue({
      reportId: 'RM-abcd1234-2026-09-26',
      site: { name: 'Северный' },
    });

    await emitDomainEvent(downtimeEvent());

    expect(findFirstMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { reportId: 'RM-abcd1234-2026-09-26', tenantId: 'tenant-a' },
    }));
    expect(sendAlertMock).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Простой 2 ч 20 мин зафиксирован в отчёте',
      siteName: 'Северный',
      reportNumber: 'RM-abcd1234-2026-09-26',
      timeZone: 'Asia/Krasnoyarsk',
    }));
  });

  it('падает обратно на строки с id, если отчёт не нашёлся', async () => {
    findFirstMock.mockResolvedValue(null);

    await emitDomainEvent(downtimeEvent());

    expect(sendAlertMock).toHaveBeenCalledWith(expect.objectContaining({
      siteName: undefined,
      reportNumber: undefined,
    }));
  });
});

/*
  F-R33-2: upsertReport пересобирает агрегат со всеми строками и `addDowntime`
  заново эмитит DowntimeAdded на каждую, поэтому каждое сохранение отчёта в
  окне правки слало диспетчеру новый алерт про тот же простой — как будто
  простой новый. Дедуп по (tenantId, reportId, reasonId, duration) в Redis на
  48 ч: ключ ставится только после успешной отправки, при недоступном Redis
  шлём как раньше (дубль лучше молчания).
*/
describe('дедупликация алерта о простое (F-R33-2)', () => {
  const sentKeys = new Map<string, string>();

  beforeEach(() => {
    sentKeys.clear();
    findFirstMock.mockReset();
    sendAlertMock.mockReset();
    isNotifMock.mockReset();
    getSettingsMock.mockReset();
    redisGetClientMock.mockReset();
    redisGetMock.mockReset();
    redisSetMock.mockReset();

    redisGetMock.mockImplementation(async (key: string) => sentKeys.get(key) ?? null);
    redisSetMock.mockImplementation(async (key: string, value: string) => {
      sentKeys.set(key, value);
      return 'OK';
    });
    redisGetClientMock.mockResolvedValue({ get: redisGetMock, set: redisSetMock });

    findFirstMock.mockResolvedValue(null);
    isNotifMock.mockResolvedValue(true);
    getSettingsMock.mockResolvedValue({ timezone: 'Europe/Moscow' });
    sendAlertMock.mockResolvedValue(true);
    registerAlertEventHandler();
  });

  function downtimeEvent(id: string, overrides: { data?: Record<string, unknown>; tenantId?: string } = {}) {
    return {
      id,
      type: REPORT_DOMAIN_EVENT_TYPES.DOWNTIME_ADDED,
      aggregateId: 'RM-1234-2026-09-26',
      aggregateType: 'Report' as const,
      occurredAt: new Date().toISOString(),
      siteId: 'site-1',
      userId: 'user-1',
      tenantId: overrides.tenantId ?? 'tenant-a',
      data: { reasonId: 'reason-1', duration: 3, ...overrides.data },
    };
  }

  it('тот же простой из нового события — одна отправка', async () => {
    await emitDomainEvent(downtimeEvent('evt-dt-1'));
    await emitDomainEvent(downtimeEvent('evt-dt-2'));

    expect(sendAlertMock).toHaveBeenCalledTimes(1);
  });

  it('разный простой (другая причина или длительность) — две отправки', async () => {
    await emitDomainEvent(downtimeEvent('evt-dt-1'));
    await emitDomainEvent(downtimeEvent('evt-dt-2', { data: { reasonId: 'reason-2' } }));
    await emitDomainEvent(downtimeEvent('evt-dt-3', { data: { duration: 5 } }));

    expect(sendAlertMock).toHaveBeenCalledTimes(3);
  });

  it('у той же строки, но другой организации — своя отправка', async () => {
    await emitDomainEvent(downtimeEvent('evt-dt-1'));
    await emitDomainEvent(downtimeEvent('evt-dt-2', { tenantId: 'tenant-b' }));

    expect(sendAlertMock).toHaveBeenCalledTimes(2);
  });

  it('неудачная отправка не закрывает повтор: ключ ставится только после успеха', async () => {
    sendAlertMock.mockResolvedValue(false);
    await emitDomainEvent(downtimeEvent('evt-dt-1'));
    expect(redisSetMock).not.toHaveBeenCalled();

    sendAlertMock.mockResolvedValue(true);
    await emitDomainEvent(downtimeEvent('evt-dt-2'));

    expect(sendAlertMock).toHaveBeenCalledTimes(2);
    expect(redisSetMock).toHaveBeenCalledWith(
      'alert:downtime:tenant-a:RM-1234-2026-09-26:reason-1:3', '1', 'EX', 48 * 60 * 60,
    );
  });

  it('при недоступном Redis шлём без дедупа', async () => {
    redisGetClientMock.mockResolvedValue(null);

    await emitDomainEvent(downtimeEvent('evt-dt-1'));
    await emitDomainEvent(downtimeEvent('evt-dt-2'));

    expect(sendAlertMock).toHaveBeenCalledTimes(2);
  });
});
