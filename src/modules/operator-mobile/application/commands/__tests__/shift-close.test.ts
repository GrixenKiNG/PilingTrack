// @vitest-environment node
import {beforeEach, describe, expect, it, vi} from 'vitest';

/*
  СДАЧА СМЕНЫ С ТЕЛЕФОНА ОСТАВЛЯЕТ СЛЕД В ИСТОРИИ ОТЧЁТА.

  `ReportAudit` писали только создание и правка отчёта (`report-command.service.ts`),
  а `closeShift` переводил статус в `submitted` напрямую: в истории отчёта были
  «Создан»/«Изменён», но не было шага сдачи — когда отчёт закрылся и кто его сдал,
  из журнала не следовало (F-R34-4). Строка пишется в той же транзакции, что и
  сам статус: иначе смена закрылась бы, а следа сдачи не осталось.
*/
const {withReadinessTenantTransaction} = vi.hoisted(() => ({withReadinessTenantTransaction: vi.fn()}));
vi.mock('@/modules/readiness/server', () => ({withReadinessTenantTransaction}));

const {writeReportAuditRow} = vi.hoisted(() => ({writeReportAuditRow: vi.fn()}));
vi.mock('@/services/reports/audit-service', () => ({writeReportAuditRow}));

import {closeShift, finishWork, submitReport} from '../shift-close';

const input = {
  tenantId: 'tenant-a',
  operatorId: 'operator-a',
  shiftId: 'shift-1234-5678',
  comment: 'Смена закрыта',
  now: new Date('2026-09-26T20:00:00.000Z'),
};

/** Клиент транзакции: только то, до чего команда доходит при закрытии смены. */
const tx = {
  shift: {findFirst: vi.fn(), update: vi.fn()},
  crew: {findFirst: vi.fn()},
  operatorChecklistExecution: {findFirst: vi.fn()},
  inspection: {findFirst: vi.fn()},
  report: {findFirst: vi.fn(), upsert: vi.fn(), update: vi.fn(), findUnique: vi.fn()},
  meterReading: {findFirst: vi.fn()},
  operatorShiftEvidence: {findFirst: vi.fn()},
  outboxEvent: {create: vi.fn()},
};

beforeEach(() => {
  vi.clearAllMocks();
  // `clearAllMocks` чистит только вызовы: реализацию (например rejection из
  // теста падения следа) нужно снимать отдельно, иначе она протечёт в следующий тест.
  writeReportAuditRow.mockReset();
  tx.shift.findFirst.mockResolvedValue({
    id: input.shiftId, state: 'STARTED', equipmentId: 'equipment-1',
    productionDate: new Date('2026-09-26T00:00:00.000Z'), type: 'DAY',
    startedAt: new Date('2026-09-26T08:00:00.000Z'), timezone: 'Europe/Moscow',
    starter: {id: input.operatorId, role: 'OPERATOR'},
  });
  tx.crew.findFirst.mockResolvedValue({id: 'crew-1', siteId: 'site-1'});
  // Отчёт за смену ещё не заведён — чужая смена по нему не определяется.
  tx.report.findFirst.mockResolvedValue(null);
  // Послесменный осмотр пройден — иначе смена не закроется.
  tx.operatorChecklistExecution.findFirst.mockResolvedValue({id: 'check-1'});
  // Осмотра фазы POST_SHIFT нет: `submitReport` принимает любой из двух способов.
  tx.inspection.findFirst.mockResolvedValue(null);
  tx.report.upsert.mockResolvedValue({id: 'report-pk-1'});
  tx.report.update.mockResolvedValue({reportId: 'RM-shift-12-2026-09-26'});
  tx.report.findUnique.mockResolvedValue({
    reportId: 'RM-shift-12-2026-09-26', siteId: 'site-1', userId: input.operatorId,
    piles: [], drillings: [], downtimes: [],
  });
  tx.meterReading.findFirst.mockResolvedValue({engineHours: 1234});
  tx.operatorShiftEvidence.findFirst.mockResolvedValue({payload: {fuelPercent: 42}});
  withReadinessTenantTransaction.mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test: фиктивный клиент транзакции вместо Prisma
    async (_tenantId: string, work: (client: any) => Promise<unknown>) => work(tx),
  );
});

describe('closeShift — след сдачи в истории отчёта', () => {
  it('пишет строку «submitted» от имени оператора в транзакции смены', async () => {
    await expect(closeShift(input)).resolves.toEqual({ok: true, reportId: 'report-pk-1'});

    expect(writeReportAuditRow).toHaveBeenCalledTimes(1);
    const [record, client] = writeReportAuditRow.mock.calls[0];
    expect(record).toEqual(expect.objectContaining({
      action: 'submitted',
      userId: input.operatorId,
    }));
    // Второй аргумент — клиент транзакции: след обязан быть атомарным со статусом.
    expect(client).toBe(tx);
  });

  it('ссылается на деловой номер отчёта, а не на первичный ключ', async () => {
    await closeShift(input);

    expect(tx.report.update).toHaveBeenCalledWith(expect.objectContaining({
      where: {id: 'report-pk-1'},
      select: {reportId: true},
    }));
    expect(writeReportAuditRow.mock.calls[0][0]).toEqual(
      expect.objectContaining({reportId: 'RM-shift-12-2026-09-26'}),
    );
  });

  it('пишет след после перевода статуса, а не до него', async () => {
    await closeShift(input);

    expect(tx.report.update.mock.invocationCallOrder[0])
      .toBeLessThan(writeReportAuditRow.mock.invocationCallOrder[0]);
  });

  it('падение записи следа роняет закрытие смены, а не проходит молча', async () => {
    writeReportAuditRow.mockRejectedValue(new Error('audit table is down'));

    await expect(closeShift(input)).rejects.toThrow(/audit table is down/);
    expect(tx.shift.update).not.toHaveBeenCalled();
  });
});

/*
  КОНЕЦ РАБОТЫ: СМЕНА ИДЁТ В «СДАЁТСЯ», ПОВТОР НЕ РОНЯЕТ КОМАНДУ.

  `finishWork` — единственная команда, где проверки закрепления не было: чужую
  смену можно было перевести в HANDOVER_PENDING одним идентификатором. Повтор
  безопасен: `requireOpenShift` пропускает HANDOVER_PENDING сознательно — в этом
  состоянии ещё сдают ЕО после работы и закрывают смену, — поэтому второй вызов
  доходит до того же перевода и отвечает успехом.
*/
describe('finishWork — смена переходит в «сдаётся», повтор идемпотентен', () => {
  const finishInput = {tenantId: 'tenant-a', operatorId: 'operator-a', shiftId: 'shift-1234-5678'};

  it('переводит смену в HANDOVER_PENDING', async () => {
    await expect(finishWork(finishInput)).resolves.toEqual({ok: true});

    expect(tx.shift.update).toHaveBeenCalledWith({
      where: {tenantId_id: {tenantId: 'tenant-a', id: finishInput.shiftId}},
      data: {state: 'HANDOVER_PENDING', lastEditedById: finishInput.operatorId},
    });
  });

  it('повторный вызов уже сдающейся смены отвечает успехом, а не отказом', async () => {
    await finishWork(finishInput);
    // Смена уже в HANDOVER_PENDING — ровно то состояние, которое оставил первый вызов.
    tx.shift.findFirst.mockResolvedValue({
      id: finishInput.shiftId, state: 'HANDOVER_PENDING', equipmentId: 'equipment-1',
      productionDate: new Date('2026-09-26T00:00:00.000Z'), type: 'DAY',
      starter: {id: finishInput.operatorId, role: 'OPERATOR'},
    });

    await expect(finishWork(finishInput)).resolves.toEqual({ok: true});
    expect(tx.shift.update).toHaveBeenCalledTimes(2);
  });
});

/*
  ЗАКРЫТИЕ СМЕНЫ: УСЛОВИЕ И СОСТОЯНИЕ.

  Послесменное обслуживание — условие закрытия, а не пожелание: машина,
  оставленная без осмотра, утром становится чужой проблемой. Чужую и уже
  закрытую смену команда не трогает — это решает `requireOpenShift`. Успешное
  закрытие переводит смену в CLOSED.
*/
describe('closeShift — правила закрытия', () => {
  const shiftRow = (overrides: Record<string, unknown> = {}) => ({
    id: input.shiftId, state: 'STARTED', equipmentId: 'equipment-1',
    productionDate: new Date('2026-09-26T00:00:00.000Z'), type: 'DAY',
    startedAt: new Date('2026-09-26T08:00:00.000Z'), timezone: 'Europe/Moscow',
    starter: {id: input.operatorId, role: 'OPERATOR'},
    ...overrides,
  });

  it('не закрывает смену без выполненного ЕО после работы', async () => {
    tx.operatorChecklistExecution.findFirst.mockResolvedValue(null);

    await expect(closeShift(input)).rejects.toThrow('Сначала выполните ЕО после работы');
    expect(tx.shift.update).not.toHaveBeenCalled();
    expect(writeReportAuditRow).not.toHaveBeenCalled();
  });

  it('отказывает в чужой смене', async () => {
    tx.shift.findFirst.mockResolvedValue(shiftRow({starter: {id: 'operator-other', role: 'OPERATOR'}}));

    await expect(closeShift(input)).rejects.toThrow('Эту смену ведёт другой машинист');
    expect(tx.shift.update).not.toHaveBeenCalled();
  });

  it('отказывает в уже закрытой смене', async () => {
    tx.shift.findFirst.mockResolvedValue(shiftRow({state: 'CLOSED'}));

    await expect(closeShift(input)).rejects.toThrow('Смена уже закрыта');
    expect(tx.shift.update).not.toHaveBeenCalled();
  });

  it('успешное закрытие переводит смену в CLOSED', async () => {
    await closeShift(input);

    expect(tx.shift.update).toHaveBeenCalledWith(expect.objectContaining({
      where: {tenantId_id: {tenantId: 'tenant-a', id: input.shiftId}},
      data: expect.objectContaining({state: 'CLOSED', closedById: input.operatorId}),
    }));
  });
});

/*
  СДАЧА ОТЧЁТА БЕЗ ЗАКРЫТИЯ СМЕНЫ (КОНТУР ГОТОВНОСТИ).

  `submitReport` переводит отчёт в `submitted` и пишет в историю отчёта строку
  сдачи «submitted» в ТОЙ ЖЕ транзакции — через общий `submitShiftReport`, что и
  `closeShift`: ответ на вопрос «что такое сданный отчёт» должен быть один.
*/
describe('submitReport — след сдачи в истории отчёта', () => {
  const submitInput = {
    tenantId: 'tenant-a', operatorId: 'operator-a', shiftId: 'shift-1234-5678',
    comment: 'Отчёт со смены', now: new Date('2026-09-26T20:00:00.000Z'),
  };

  it('пишет строку «submitted» и переводит отчёт в submitted', async () => {
    await expect(submitReport(submitInput)).resolves.toEqual({reportId: 'report-pk-1'});

    expect(tx.report.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({status: 'submitted', submittedAt: submitInput.now}),
    }));
    expect(writeReportAuditRow).toHaveBeenCalledTimes(1);
    const [record, client] = writeReportAuditRow.mock.calls[0];
    expect(record).toEqual(expect.objectContaining({
      action: 'submitted',
      userId: submitInput.operatorId,
      reportId: 'RM-shift-12-2026-09-26',
    }));
    // Второй аргумент — клиент транзакции: след обязан быть атомарным со статусом.
    expect(client).toBe(tx);
  });

  /*
    ПОВТОРНАЯ СДАЧА НЕ ОТВЕРГАЕТСЯ — ФАКТИЧЕСКОЕ ПОВЕДЕНИЕ.

    У команды `submit-report` нет ни `clientCommandId`, ни проверки уже сданного
    отчёта: контур готовности держит смену открытой после сдачи, поэтому
    `requireOpenShift` пропускает повтор, и вторая сдача пишет вторую строку
    истории и второе событие `ReportSubmitted`. Тест фиксирует это как есть —
    расхождение с ожидаемым «отказ/идемпотентность» описано в отчёте по задаче.
  */
  it('повторная сдача принимается и пишет вторую строку истории', async () => {
    await submitReport(submitInput);
    await submitReport(submitInput);

    expect(writeReportAuditRow).toHaveBeenCalledTimes(2);
    expect(tx.outboxEvent.create).toHaveBeenCalledTimes(2);
  });
});
