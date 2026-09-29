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

import {closeShift} from '../shift-close';

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
  report: {findFirst: vi.fn(), upsert: vi.fn(), update: vi.fn(), findUnique: vi.fn()},
  meterReading: {findFirst: vi.fn()},
  operatorShiftEvidence: {findFirst: vi.fn()},
  outboxEvent: {create: vi.fn()},
};

beforeEach(() => {
  vi.clearAllMocks();
  tx.shift.findFirst.mockResolvedValue({
    id: input.shiftId, state: 'STARTED', equipmentId: 'equipment-1',
    productionDate: new Date('2026-09-26T00:00:00.000Z'), type: 'DAY',
    startedAt: new Date('2026-09-26T08:00:00.000Z'), timezone: 'Europe/Moscow',
    starter: {id: input.operatorId, role: 'OPERATOR'},
  });
  tx.crew.findFirst.mockResolvedValue({id: 'crew-1', siteId: 'site-1'});
  // Послесменный осмотр пройден — иначе смена не закроется.
  tx.operatorChecklistExecution.findFirst.mockResolvedValue({id: 'check-1'});
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
