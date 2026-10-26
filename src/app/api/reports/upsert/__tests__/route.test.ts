// @vitest-environment node
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {NextRequest} from 'next/server';

/*
  Сохранение сменного отчёта (форма веб-интерфейса).

  Держится:
  - схема тела настоящая; при её отказе пишется предупреждение в ленту и ответ 400;
  - организация и пользователь — из сессии; чужое userId из тела проходит только
    через проверку «можно ли действовать за него» и до сервиса не доходит без неё;
  - показание моточасов — необязательное приложение к отчёту: отказ правила учёта
    (422) возвращается оператору в `meterError`, прочие сбои только в журнал, и в
    обоих случаях отчёт сохранён;
  - повтор отправки формы не создаёт второе показание (`dedupeByNote`), а снижение
    счётчика оператору недоступно.
*/
const h = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  assertCanActForUser: vi.fn(),
  resolveReportUserId: vi.fn(),
  upsertReport: vi.fn(),
  saveReportEndingEngineHours: vi.fn(),
  addMeterReading: vi.fn(),
  recordFeedbackEvent: vi.fn(),
  invalidateReports: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock('@/core/api-wrapper', async () => {
  const {ServiceError} = await import('@/lib/service-error');
  return {
    withMutation: (handler: unknown) => handler,
    readJsonBody: async (request: NextRequest) => {
      try { return await request.json(); } catch { throw new ServiceError('Тело запроса должно быть корректным JSON', 400); }
    },
  };
});
vi.mock('@/lib/auth', () => ({requireAuth: h.requireAuth}));
vi.mock('@/services/feedback/feedback-event-service', () => ({recordFeedbackEvent: h.recordFeedbackEvent}));
vi.mock('@/lib/cached-queries', () => ({invalidateReports: h.invalidateReports}));
vi.mock('@/lib/logger', () => ({logger: {warn: h.loggerWarn, error: vi.fn(), info: vi.fn()}}));
vi.mock('@/modules/reports', () => ({
  assertCanActForUser: h.assertCanActForUser,
  resolveReportUserId: h.resolveReportUserId,
  upsertReport: h.upsertReport,
  saveReportEndingEngineHours: h.saveReportEndingEngineHours,
}));
vi.mock('@/modules/equipment', () => ({addMeterReading: h.addMeterReading}));

import {ServiceError} from '@/lib/service-error';
import {POST} from '../route';

type Handler = (request: NextRequest) => Promise<Response>;
const post = (body: unknown) => (POST as unknown as Handler)(new NextRequest('http://localhost/api/reports/upsert', {
  method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body),
}));

const OPERATOR = {id: 'op-1', name: 'Иван', role: 'OPERATOR', tenantId: 'tenant-a'};
const BODY = {siteId: 'site-1', date: '2026-10-26', shiftType: 'DAY', equipmentId: 'eq-1'};
const SAVED = {
  _action: 'created',
  report: {reportId: 'R-1', version: 1, siteId: 'site-1', date: '2026-10-26', endingEngineHours: null},
};

beforeEach(() => {
  vi.clearAllMocks();
  h.assertCanActForUser.mockReset();
  h.requireAuth.mockResolvedValue({user: OPERATOR, error: null});
  h.resolveReportUserId.mockImplementation((_actor: unknown, requested: string) => requested);
  h.upsertReport.mockResolvedValue(structuredClone(SAVED));
  h.addMeterReading.mockResolvedValue({warning: null, reading: {engineHours: 1234}});
  h.saveReportEndingEngineHours.mockResolvedValue(true);
});

describe('POST /api/reports/upsert — вход и проверка тела', () => {
  it('без сессии сервис не вызывается', async () => {
    h.requireAuth.mockResolvedValue({user: null, error: new Response('{}', {status: 401})});

    expect((await post(BODY)).status).toBe(401);
    expect(h.upsertReport).not.toHaveBeenCalled();
  });

  it('некорректное тело: 400 с перечнем полей и предупреждением в ленту, отчёт не пишется', async () => {
    const response = await post({siteId: 'site-1', date: '26.10.2026'});

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.details).toEqual(expect.arrayContaining([expect.objectContaining({field: 'date'})]));
    expect(h.recordFeedbackEvent).toHaveBeenCalledWith(expect.objectContaining({
      level: 'warn', action: 'report.validation_failed', actor: {id: 'op-1', name: 'Иван', role: 'OPERATOR'},
    }));
    expect(h.upsertReport).not.toHaveBeenCalled();
  });
});

describe('POST /api/reports/upsert — кто и в какой организации', () => {
  it('организация — из сессии, автор — сессия, если в теле его нет', async () => {
    await post(BODY);

    expect(h.assertCanActForUser).toHaveBeenCalledWith(OPERATOR, 'op-1');
    const [command, options] = h.upsertReport.mock.calls[0];
    expect(command).toMatchObject({tenantId: 'tenant-a', userId: 'op-1', siteId: 'site-1', date: '2026-10-26', shiftType: 'DAY'});
    expect(options).toEqual({enforceEditWindow: true, actor: OPERATOR});
  });

  it('чужой userId из тела сначала проверяется на право действовать за него', async () => {
    h.assertCanActForUser.mockImplementation(() => { throw new ServiceError('Нет доступа', 403); });

    await expect(post({...BODY, userId: 'someone-else'})).rejects.toMatchObject({status: 403});
    expect(h.assertCanActForUser).toHaveBeenCalledWith(OPERATOR, 'someone-else');
    expect(h.upsertReport).not.toHaveBeenCalled();
  });

  it('пользователь без организации получает отказ до записи', async () => {
    h.requireAuth.mockResolvedValue({user: {...OPERATOR, tenantId: null}, error: null});

    await expect(post(BODY)).rejects.toMatchObject({status: 403});
    expect(h.upsertReport).not.toHaveBeenCalled();
  });

  it('организация из тела запроса не принимается', async () => {
    await post({...BODY, tenantId: 'tenant-evil'});

    expect(h.upsertReport.mock.calls[0][0].tenantId).toBe('tenant-a');
  });

  it('идентификатор отчёта: из тела, иначе из id, иначе новый', async () => {
    await post({...BODY, reportId: 'R-7'});
    await post({...BODY, id: 'R-8'});
    await post(BODY);

    expect(h.upsertReport.mock.calls.map(([command]) => command.reportId).slice(0, 2)).toEqual(['R-7', 'R-8']);
    expect(h.upsertReport.mock.calls[2][0].reportId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('версия из тела уходит как ожидаемая: устаревшая правка получит 409 от сервиса', async () => {
    await post({...BODY, version: 3});

    expect(h.upsertReport.mock.calls[0][0].expectedVersion).toBe(3);
  });
});

describe('POST /api/reports/upsert — итог и лента', () => {
  it('создание: ответ с отчётом, событие «отправлен», кэш отчётов сброшен', async () => {
    const response = await post(BODY);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.report.report.reportId).toBe('R-1');
    expect(body).toMatchObject({meterWarning: null, meterError: null});
    expect(h.recordFeedbackEvent).toHaveBeenCalledWith(expect.objectContaining({
      level: 'success', action: 'report.submit.created', targetId: 'R-1',
    }));
    expect(h.invalidateReports).toHaveBeenCalled();
  });

  it('правка существующего отчёта: событие «обновлён»', async () => {
    h.upsertReport.mockResolvedValue({...structuredClone(SAVED), _action: 'updated'});

    await post(BODY);

    expect(h.recordFeedbackEvent).toHaveBeenCalledWith(expect.objectContaining({action: 'report.submit.updated'}));
  });
});

describe('POST /api/reports/upsert — моточасы в конце смены', () => {
  it('без моточасов журнал счётчика не трогается', async () => {
    await post(BODY);

    expect(h.addMeterReading).not.toHaveBeenCalled();
  });

  it('без установки моточасы некуда записать', async () => {
    await post({siteId: 'site-1', date: '2026-10-26', engineHours: 1234});

    expect(h.addMeterReading).not.toHaveBeenCalled();
  });

  it('записываются с защитой от повтора и без права снижать счётчик; итог попадает в отчёт', async () => {
    const response = await post({...BODY, engineHours: 1234});

    expect(h.addMeterReading).toHaveBeenCalledWith(
      'eq-1',
      expect.objectContaining({engineHours: 1234, note: expect.stringContaining('2026-10-26')}),
      {tenantId: 'tenant-a', recordedById: 'op-1', allowDecrease: false, dedupeByNote: true},
    );
    expect(h.saveReportEndingEngineHours).toHaveBeenCalledWith(expect.objectContaining({
      reportId: 'R-1', version: 1, equipmentId: 'eq-1', tenantId: 'tenant-a', engineHours: 1234,
    }));
    expect((await response.json()).report.report.endingEngineHours).toBe(1234);
  });

  it('предупреждение учёта (например, большой скачок) возвращается оператору', async () => {
    h.addMeterReading.mockResolvedValue({warning: 'Скачок наработки', reading: {engineHours: 1234}});

    expect((await (await post({...BODY, engineHours: 1234})).json()).meterWarning).toBe('Скачок наработки');
  });

  it('отказ правила учёта (счётчик назад, 422) доходит до оператора, отчёт сохранён', async () => {
    h.addMeterReading.mockRejectedValue(new ServiceError('Показание меньше предыдущего', 422));

    const response = await post({...BODY, engineHours: 10});

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({meterError: 'Показание меньше предыдущего'});
    expect(h.upsertReport).toHaveBeenCalledTimes(1);
    expect(h.loggerWarn).not.toHaveBeenCalled();
  });

  it('прочий сбой журнала счётчика не теряет отчёт и пишется в журнал приложения', async () => {
    h.addMeterReading.mockRejectedValue(new Error('база недоступна'));

    const response = await post({...BODY, engineHours: 1234});

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({meterError: null});
    expect(h.loggerWarn).toHaveBeenCalledWith('meter reading or report snapshot failed', expect.objectContaining({
      equipmentId: 'eq-1', error: 'база недоступна',
    }));
  });

  it('снимок моточасов в отчёте не сохранён (версия ушла вперёд) — поле отчёта остаётся прежним', async () => {
    h.saveReportEndingEngineHours.mockResolvedValue(false);

    const body = await (await post({...BODY, engineHours: 1234})).json();

    expect(body.report.report.endingEngineHours).toBeNull();
  });
});
