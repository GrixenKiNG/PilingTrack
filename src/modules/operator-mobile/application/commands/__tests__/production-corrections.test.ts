// @vitest-environment node
import {beforeEach, describe, expect, it, vi} from 'vitest';

/*
  ПОПРАВКА ВЫРАБОТКИ ОСТАВЛЯЕТ СЛЕД В ИСТОРИИ ОТЧЁТА.

  `ReportAudit` писали только создание и правка отчёта (`report-command.service.ts`),
  а поправка выработки мобильного контура ложилась без единой строки: в истории
  отчёта не было видно, что и когда в нём поправили (F-R34-2). Строка пишется в
  ТОЙ ЖЕ транзакции, что и сама поправка, и деловым номером отчёта (`RM-…`),
  потому что история отчёта ищет строки именно по нему.
*/
const {withReadinessTenantTransaction} = vi.hoisted(() => ({withReadinessTenantTransaction: vi.fn()}));
vi.mock('@/modules/readiness/server', () => ({withReadinessTenantTransaction}));
// `writeReportAuditRow` пишет след через переданный клиент транзакции; `db`
// здесь не нужен, а его импорт тянет Prisma-рантайм в тестовый процесс.
vi.mock('@/lib/db', () => ({db: {}}));

import {correctProduction} from '../production-corrections';

const input = {
  tenantId: 'tenant-a',
  operatorId: 'operator-a',
  shiftId: 'shift-1234-5678',
  kind: 'PILES' as const,
  entryId: 'pw-1',
  actual: 8,
  reason: 'ошибся при вводе',
  clientCommandId: 'cmd-corr-1',
  now: new Date('2026-09-26T10:00:00.000Z'),
};

/** Клиент транзакции: только то, до чего команда доходит при поправке свай. */
const tx = {
  $executeRaw: vi.fn(),
  shift: {findFirst: vi.fn()},
  crew: {findFirst: vi.fn()},
  report: {findFirst: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn()},
  pileWork: {findUnique: vi.fn(), findFirst: vi.fn(), aggregate: vi.fn(), create: vi.fn()},
  reportDowntime: {findUnique: vi.fn(), findFirst: vi.fn(), aggregate: vi.fn(), findMany: vi.fn(), create: vi.fn()},
  reportAudit: {create: vi.fn()},
  user: {findFirst: vi.fn().mockResolvedValue({name: 'Иванов', role: 'OPERATOR'})},
};

beforeEach(() => {
  vi.clearAllMocks();
  tx.shift.findFirst.mockResolvedValue({
    id: input.shiftId, state: 'STARTED', equipmentId: 'equipment-1',
    productionDate: new Date('2026-09-26T00:00:00.000Z'), type: 'DAY',
    starter: {id: input.operatorId, role: 'OPERATOR'},
  });
  tx.crew.findFirst.mockResolvedValue({id: 'crew-1', siteId: 'site-1'});
  // Один и тот же `findFirst` у `Report`: в `requireOpenShift` он читает
  // владельца смены, в самой команде — статус отчёта.
  tx.report.findFirst.mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test: разбор аргументов фиктивного клиента
    async (args: any) => (args?.select?.status ? {status: 'draft'} : {userId: input.operatorId}),
  );
  // Один и тот же `findUnique` у `PileWork`: по ключу команды — проверка
  // повтора (нужен null), по id — текущее количество исходной записи.
  tx.pileWork.findUnique.mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test: разбор аргументов фиктивного клиента
    async (args: any) => (args?.where?.id ? {count: 10} : null),
  );
  tx.pileWork.findFirst.mockResolvedValue({
    id: 'pw-1', reportId: 'report-pk-1', pileGradeId: 'grade-1', correctsId: null,
  });
  // К исходной записи уже была одна поправка на +3.
  tx.pileWork.aggregate.mockResolvedValue({_sum: {count: 3}});
  tx.pileWork.create.mockResolvedValue({id: 'pw-corr-1'});
  tx.reportDowntime.findUnique.mockResolvedValue(null);
  tx.reportDowntime.findFirst.mockResolvedValue({id: 'dt-1', reportId: 'report-pk-1', reasonId: 'reason-1', duration: 2, correctsId: null});
  tx.reportDowntime.aggregate.mockResolvedValue({_sum: {duration: 0}});
  tx.reportDowntime.findMany.mockResolvedValue([{duration: 2}, {duration: 8}]);
  tx.reportDowntime.create.mockResolvedValue({id: 'dt-corr-1'});
  tx.report.findUniqueOrThrow.mockResolvedValue({reportId: 'RM-shift-12-2026-09-26'});
  tx.reportAudit.create.mockResolvedValue({});
  withReadinessTenantTransaction.mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test: фиктивный клиент транзакции вместо Prisma
    async (_tenantId: string, work: (client: any) => Promise<unknown>) => work(tx),
  );
});

describe('correctProduction — след поправки в истории отчёта', () => {
  it.each([500, 24.25, 1.3, NaN, Infinity])('отвергает недопустимые часы %s без записи', async (actual) => {
    await expect(correctProduction({...input, kind: 'DOWNTIME', entryId: 'dt-1', actual})).rejects.toThrow();
    expect(tx.reportDowntime.create).not.toHaveBeenCalled();
    expect(tx.report.update).not.toHaveBeenCalled();
  });

  it('считает предел смены с учётом остальных простоев и прежних поправок', async () => {
    await expect(correctProduction({...input, kind: 'DOWNTIME', entryId: 'dt-1', actual: 5})).rejects.toThrow('продолжительность смены');
    expect(tx.reportDowntime.create).not.toHaveBeenCalled();
    tx.reportDowntime.aggregate.mockResolvedValue({_sum: {duration: -1}});
    tx.reportDowntime.findMany.mockResolvedValue([{duration: 2}, {duration: -1}, {duration: 8}]);
    await expect(correctProduction({...input, kind: 'DOWNTIME', entryId: 'dt-1', actual: 4})).resolves.toMatchObject({was: 1, now: 4});
    expect(tx.reportDowntime.create).toHaveBeenCalledWith(expect.objectContaining({data: expect.objectContaining({duration: 3})}));
  });

  it('разрешает отменить простой до нуля', async () => {
    await expect(correctProduction({...input, kind: 'DOWNTIME', entryId: 'dt-1', actual: 0})).resolves.toMatchObject({now: 0});
    expect(tx.reportDowntime.create).toHaveBeenCalledWith(expect.objectContaining({data: expect.objectContaining({duration: -2})}));
  });
  it('пишет строку «updated» с «было → стало» деловым номером отчёта', async () => {
    await expect(correctProduction(input)).resolves.toEqual({
      correctionId: 'pw-corr-1', was: 13, now: 8,
    });

    expect(tx.reportAudit.create).toHaveBeenCalledTimes(1);
    const {data} = tx.reportAudit.create.mock.calls[0][0];
    expect(data).toEqual(expect.objectContaining({
      reportId: 'RM-shift-12-2026-09-26',
      actorId: 'operator-a',
      actorName: 'Иванов', actorRole: 'OPERATOR',
      action: 'updated',
    }));
    expect(JSON.stringify(data.diff)).toContain('было');
    expect(JSON.stringify(data.diff)).toContain('стало');
    expect(data.diff).toEqual({'Выработка': {old: 'было 13', new: 'стало 8'}});
  });

  it('повышает Report.version: встречная строка не должна пропасть при веб-сохранении старой формы', async () => {
    await correctProduction(input);

    expect(tx.report.update).toHaveBeenCalledWith({
      where: {id: 'report-pk-1'}, data: {version: {increment: 1}},
    });
  });

  it('повтор уже принятой поправки след не пишет и версию не двигает', async () => {
    tx.pileWork.findUnique.mockResolvedValue({id: 'pw-existing'});

    await expect(correctProduction(input)).resolves.toEqual({correctionId: 'pw-existing'});
    expect(tx.reportAudit.create).not.toHaveBeenCalled();
    expect(tx.report.update).not.toHaveBeenCalled();
  });
});
