// @vitest-environment node
import {beforeEach, describe, expect, it, vi} from 'vitest';

/*
  УПАВШАЯ ПО УНИКАЛЬНОСТИ ЗАПИСЬ ВЫРАБОТКИ НЕ ВЫДАЁТСЯ ЗА ПРИНЯТУЮ.

  P2002 в этой транзакции нарушает не только ключ команды: тот же код даёт
  уникальность отчёта за смену (`ensureReport`). Раньше любой P2002
  возвращался как «повтор уже принят», и проигравшая гонку свая терялась
  молча: в отчёт не попадала, сервер отвечал 200, клиент вынимал её из
  очереди (находка F-R31-1). Решает не код ошибки, а база: «принято» — только
  если запись с этим ключом команды там действительно есть.
*/
const {withReadinessTenantTransaction} = vi.hoisted(() => ({withReadinessTenantTransaction: vi.fn()}));
vi.mock('@/modules/readiness/server', () => ({withReadinessTenantTransaction}));
// `writeReportAuditRow` пишет след через переданный клиент транзакции; `db`
// здесь не нужен, а его импорт тянет Prisma-рантайм в тестовый процесс.
vi.mock('@/lib/db', () => ({db: {}}));

import {logProduction} from '../production';
import {ensureReport} from '../shared';

const input = {
  tenantId: 'tenant-a',
  operatorId: 'operator-a',
  shiftId: 'shift-1234-5678',
  clientCommandId: 'cmd-1',
  entry: {
    kind: 'DOWNTIME' as const,
    reasonId: 'reason-1',
    startedAt: '2026-09-26T08:00:00.000Z',
    endedAt: '2026-09-26T09:00:00.000Z',
  },
};

/** Клиент транзакции: только то, до чего команда доходит перед заведением отчёта. */
const tx = {
  shift: {findFirst: vi.fn()},
  report: {findFirst: vi.fn(), upsert: vi.fn()},
  crew: {findFirst: vi.fn()},
  reportDowntime: {findUnique: vi.fn()},
};

const uniqueViolation = () => Object.assign(
  new Error('Unique constraint failed on the fields: (`reportId`)'),
  {code: 'P2002'},
);

beforeEach(() => {
  vi.clearAllMocks();
  tx.shift.findFirst.mockResolvedValue({
    id: input.shiftId, state: 'STARTED', equipmentId: 'equipment-1',
    productionDate: new Date('2026-09-26T00:00:00.000Z'), type: 'DAY',
    starter: {id: input.operatorId, role: 'OPERATOR'},
  });
  tx.report.findFirst.mockResolvedValue(null);
  tx.crew.findFirst.mockResolvedValue({id: 'crew-1', siteId: 'site-1'});
  // Отчёт за смену завести не удалось — ровно та гонка, что и в находке.
  tx.report.upsert.mockRejectedValue(uniqueViolation());
  withReadinessTenantTransaction.mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test: фиктивный клиент транзакции вместо Prisma
    async (_tenantId: string, work: (client: any) => Promise<unknown>) => work(tx),
  );
});

describe('logProduction — P2002 без подтверждения повтора', () => {
  it('пробрасывает ошибку, если записи с этим ключом команды на сервере нет', async () => {
    tx.reportDowntime.findUnique.mockResolvedValue(null);

    await expect(logProduction(input)).rejects.toThrow(/Unique constraint failed/);
  });

  it('отвечает «повтор принят», только если запись с этим ключом команды уже есть', async () => {
    tx.reportDowntime.findUnique.mockResolvedValue({id: 'downtime-1'});

    await expect(logProduction(input)).resolves.toEqual({reportId: ''});
  });
});

/*
  ОТЧЁТ ЗА СМЕНУ ИЩЕТСЯ ПО КЛЮЧУ СМЕНЫ, А НЕ ПО НОМЕРУ ОТЧЁТА.

  Отчёт той же смены мог завестись раньше и другим путём — формой отчёта,
  у которой свой номер (`RM-…` из формы, а не из смены). Upsert по `reportId`
  такой отчёт не находил, шёл вставлять второй и падал на `@@unique([tenantId,
  shiftId])`: команда не сохранялась, очередь машиниста застревала навсегда
  (F-R31-1b).
*/
describe('ensureReport — upsert по ключу [tenantId, shiftId]', () => {
  const shiftInput = {
    tenantId: 'tenant-a',
    operatorId: 'operator-a',
    shiftId: 'shift-1234-5678',
    siteId: 'site-1',
    equipmentId: 'equipment-1',
    crewId: 'crew-1',
    productionDate: '2026-09-26',
    shiftType: 'DAY',
  };

  it('ищет отчёт по [tenantId, shiftId], не по reportId', async () => {
    tx.report.upsert.mockResolvedValue({id: 'report-1'});

    await expect(ensureReport(tx as never, shiftInput)).resolves.toBe('report-1');
    expect(tx.report.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {tenantId_shiftId: {tenantId: 'tenant-a', shiftId: 'shift-1234-5678'}},
    }));
    expect(tx.report.upsert.mock.calls[0][0].where).not.toHaveProperty('reportId');
  });

  it('подхватывает уже заведённый отчёт смены и не пытается вставить второй', async () => {
    tx.report.upsert.mockResolvedValue({id: 'report-from-form'});

    await expect(ensureReport(tx as never, shiftInput)).resolves.toBe('report-from-form');
    expect(tx.report.upsert).toHaveBeenCalledTimes(1);
    expect(tx.report.upsert.mock.calls[0][0]).toEqual(expect.objectContaining({
      update: {},
      select: {id: true},
      create: expect.objectContaining({shiftId: shiftInput.shiftId}),
    }));
  });

  it('номер отчёта для новой смены по-прежнему выводится из смены и суток', async () => {
    tx.report.upsert.mockResolvedValue({id: 'report-2'});

    await ensureReport(tx as never, shiftInput);

    expect(tx.report.upsert.mock.calls[0][0].create).toEqual(expect.objectContaining({
      reportId: 'RM-shift-12-2026-09-26',
      tenantId: 'tenant-a',
      status: 'draft',
    }));
  });
});

/*
  ЗАПИСЬ ВЫРАБОТКИ ОСТАВЛЯЕТ СЛЕД В ИСТОРИИ ОТЧЁТА.

  `ReportAudit` писали только создание и правка отчёта (`report-command.service.ts`),
  а выработка мобильного контура ложилась без единой строки: в истории отчёта не
  было видно, что и когда в него дописали (F-R34-2). Строка пишется в ТОЙ ЖЕ
  транзакции, что и сама запись выработки, и деловым номером отчёта (`RM-…`),
  потому что история отчёта ищет строки именно по нему.
*/
describe('logProduction — след записи выработки в истории отчёта', () => {
  const auditTx = {
    shift: {findFirst: vi.fn()},
    report: {findFirst: vi.fn(), upsert: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn()},
    crew: {findFirst: vi.fn()},
    operatorChecklistExecution: {findFirst: vi.fn()},
    userDocumentType: {findMany: vi.fn()},
    userDocument: {findMany: vi.fn()},
    ppeCheck: {findFirst: vi.fn()},
    equipmentDefect: {findMany: vi.fn()},
    safetyIncident: {findMany: vi.fn()},
    equipment: {findFirst: vi.fn()},
    pileGrade: {findFirst: vi.fn()},
    pileWork: {findUnique: vi.fn(), create: vi.fn()},
    reportAudit: {create: vi.fn()},
  };

  const pilesInput = {
    tenantId: 'tenant-a',
    operatorId: 'operator-a',
    shiftId: 'shift-1234-5678',
    clientCommandId: 'cmd-piles-1',
    entry: {kind: 'PILES' as const, pileGradeId: 'grade-1', count: 2},
    now: new Date('2026-09-26T10:00:00.000Z'),
  };

  beforeEach(() => {
    auditTx.shift.findFirst.mockResolvedValue({
      id: pilesInput.shiftId, state: 'STARTED', equipmentId: 'equipment-1',
      productionDate: new Date('2026-09-26T00:00:00.000Z'), type: 'DAY',
      starter: {id: pilesInput.operatorId, role: 'OPERATOR'},
    });
    auditTx.report.findFirst.mockResolvedValue(null);
    auditTx.crew.findFirst.mockResolvedValue({id: 'crew-1', siteId: 'site-1'});
    // Чек-лист ТБ пройден накануне — срок по инструкции ещё не вышел.
    auditTx.operatorChecklistExecution.findFirst.mockResolvedValue({
      startedAt: new Date('2026-09-25T09:00:00.000Z'),
    });
    auditTx.userDocumentType.findMany.mockResolvedValue([]);
    auditTx.userDocument.findMany.mockResolvedValue([]);
    auditTx.ppeCheck.findFirst.mockResolvedValue(null);
    auditTx.equipmentDefect.findMany.mockResolvedValue([]);
    auditTx.safetyIncident.findMany.mockResolvedValue([]);
    auditTx.equipment.findFirst.mockResolvedValue({isActive: true});
    auditTx.pileGrade.findFirst.mockResolvedValue({id: 'grade-1', lengthMm: 12000, name: 'С 120.30'});
    auditTx.pileWork.findUnique.mockResolvedValue(null);
    auditTx.pileWork.create.mockResolvedValue({id: 'pw-1'});
    auditTx.report.upsert.mockResolvedValue({id: 'report-pk-1'});
    auditTx.report.findUnique.mockResolvedValue({status: 'draft'});
    auditTx.report.findUniqueOrThrow.mockResolvedValue({reportId: 'RM-shift-12-2026-09-26'});
    auditTx.reportAudit.create.mockResolvedValue({});
    withReadinessTenantTransaction.mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test: фиктивный клиент транзакции вместо Prisma
      async (_tenantId: string, work: (client: any) => Promise<unknown>) => work(auditTx),
    );
  });

  it('пишет строку «updated» деловым номером отчёта через ту же транзакцию', async () => {
    await expect(logProduction(pilesInput)).resolves.toEqual({reportId: 'report-pk-1'});

    expect(auditTx.report.findUniqueOrThrow).toHaveBeenCalledWith({
      where: {id: 'report-pk-1'}, select: {reportId: true},
    });
    expect(auditTx.reportAudit.create).toHaveBeenCalledTimes(1);
    const {data} = auditTx.reportAudit.create.mock.calls[0][0];
    expect(data).toEqual(expect.objectContaining({
      reportId: 'RM-shift-12-2026-09-26',
      actorId: 'operator-a',
      action: 'updated',
      diff: {'Выработка': {old: null, new: 'сваи: +2 шт (С 120.30)'}},
    }));
  });

  it('повтор уже принятой команды след не пишет', async () => {
    auditTx.pileWork.findUnique.mockResolvedValue({id: 'pw-existing'});

    await expect(logProduction(pilesInput)).resolves.toEqual({reportId: ''});
    expect(auditTx.reportAudit.create).not.toHaveBeenCalled();
  });
});

/*
  ПОСЛЕ «ЗАВЕРШИТЬ РАБОТУ» ВЫРАБОТКА БОЛЬШЕ НЕ ЗАПИСЫВАЕТСЯ, А ПРОСТОЙ — ЗАПИСЫВАЕТСЯ.

  `finishWork` переводит смену в HANDOVER_PENDING, и на экране кнопки выработки
  исчезают. Прямой запрос к API их не спрашивал: после «Завершить работу» сваи
  продолжали ложиться в уже сдаваемую смену. Правило стоит в самой команде:
  `requireOpenShift` пропускает HANDOVER_PENDING сознательно (в этом состоянии
  ещё сдают ЕО после работы и закрывают смену), поэтому запрет на выработку
  живёт здесь, а не там. Простой не запрещён: им машинист объясняет остановку,
  и последний отрезок обычно вносится уже при сдаче.
*/
describe('logProduction — после завершения работы принимается только простой', () => {
  const finishTx = {
    shift: {findFirst: vi.fn()},
    report: {findFirst: vi.fn(), upsert: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn()},
    crew: {findFirst: vi.fn()},
    pileWork: {findUnique: vi.fn(), create: vi.fn()},
    leaderDrilling: {findUnique: vi.fn(), create: vi.fn()},
    reportDowntime: {findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn()},
    downtimeReason: {findFirst: vi.fn()},
    reportAudit: {create: vi.fn()},
  };

  const shiftRow = (state: string) => ({
    id: 'shift-1234-5678', state, equipmentId: 'equipment-1',
    productionDate: new Date('2026-09-26T00:00:00.000Z'), type: 'DAY',
    startedAt: new Date('2026-09-26T07:00:00.000Z'), timezone: 'Europe/Moscow',
    starter: {id: 'operator-a', role: 'OPERATOR'},
  });

  const base = {
    tenantId: 'tenant-a', operatorId: 'operator-a', shiftId: 'shift-1234-5678',
    now: new Date('2026-09-26T10:00:00.000Z'),
  };

  const workEntries: Record<'PILES' | 'DRILLING', Parameters<typeof logProduction>[0]['entry']> = {
    PILES: {kind: 'PILES', pileGradeId: 'grade-1', count: 1},
    DRILLING: {kind: 'DRILLING', typeId: 'type-1', count: 1, metersPerUnit: 5},
  };

  beforeEach(() => {
    vi.clearAllMocks();
    finishTx.shift.findFirst.mockResolvedValue(shiftRow('HANDOVER_PENDING'));
    finishTx.report.findFirst.mockResolvedValue(null);
    finishTx.crew.findFirst.mockResolvedValue({id: 'crew-1', siteId: 'site-1'});
    finishTx.pileWork.findUnique.mockResolvedValue(null);
    finishTx.leaderDrilling.findUnique.mockResolvedValue(null);
    finishTx.report.upsert.mockResolvedValue({id: 'report-1'});
    finishTx.report.findUnique.mockResolvedValue({status: 'draft'});
    finishTx.report.findUniqueOrThrow.mockResolvedValue({reportId: 'RM-shift-12-2026-09-26'});
    finishTx.reportAudit.create.mockResolvedValue({});
    withReadinessTenantTransaction.mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test: фиктивный клиент транзакции вместо Prisma
      async (_tenantId: string, work: (client: any) => Promise<unknown>) => work(finishTx),
    );
  });

  it.each(['PILES', 'DRILLING'] as const)('отказывает в выработке %s с понятным текстом', async (kind) => {
    await expect(logProduction({
      ...base, clientCommandId: 'cmd-1', entry: workEntries[kind],
    })).rejects.toThrow(/Работа по смене завершена/);

    expect(finishTx.pileWork.create).not.toHaveBeenCalled();
    expect(finishTx.leaderDrilling.create).not.toHaveBeenCalled();
  });

  it('в смену, которая ещё не начата, отвечает про приём установки, а не про завершение', async () => {
    finishTx.shift.findFirst.mockResolvedValue(shiftRow('PLANNED'));

    await expect(logProduction({
      ...base, clientCommandId: 'cmd-1', entry: workEntries.PILES,
    })).rejects.toThrow(/Смена ещё не начата/);
  });

  it('простой после завершения работы записывается', async () => {
    finishTx.reportDowntime.findUnique.mockResolvedValue(null);
    finishTx.reportDowntime.findMany.mockResolvedValue([]);
    finishTx.downtimeReason.findFirst.mockResolvedValue({id: 'reason-1', name: 'Ожидание механика'});
    finishTx.reportDowntime.create.mockResolvedValue({});

    await expect(logProduction({
      ...base, clientCommandId: 'cmd-dt-1',
      entry: {
        kind: 'DOWNTIME', reasonId: 'reason-1',
        startedAt: '2026-09-26T08:00:00.000Z', endedAt: '2026-09-26T09:00:00.000Z',
      },
    })).resolves.toEqual({reportId: 'report-1'});

    expect(finishTx.reportDowntime.create).toHaveBeenCalledTimes(1);
  });
});
