// @vitest-environment node
import {beforeEach, describe, expect, it, vi} from 'vitest';

/*
  ПОВТОР ОТМЕТКИ ОБ ОЗНАКОМЛЕНИИ НЕ ПЛОДИТ ЗАПИСЕЙ В ЖУРНАЛЕ ОТ.

  `acknowledge-briefing` ключа команды не спрашивает (схема маршрута его не
  содержит): ответ теряется уже после того, как транзакция прошла, машинист
  подтверждает ознакомление снова — и до этой правки в журнале ОТ появлялась
  вторая строка об одном действии (находка F-O11). Повторный инструктаж при
  этом законен: он идёт другим днём либо по новой редакции инструкции, и такая
  запись проходить обязана.
*/
const {withReadinessTenantTransaction} = vi.hoisted(() => ({withReadinessTenantTransaction: vi.fn()}));
vi.mock('@/modules/readiness/server', () => ({withReadinessTenantTransaction}));

import {acknowledgeBriefing} from '../admission';

/** Строка журнала инструктажей так, как её видит проверка повтора. */
type HistoryRow = {
  kind: string; userId: string; documentCode: string; documentVersion: string; recordedAt: Date;
};

let history: HistoryRow[];

/** Клиент транзакции: только то, до чего доходит `acknowledgeBriefing`. */
const tx = {
  userDocumentType: {findFirst: vi.fn()},
  userDocument: {findFirst: vi.fn(), create: vi.fn()},
  user: {findFirst: vi.fn()},
  briefingRecord: {findFirst: vi.fn(), create: vi.fn()},
};

const call = (now: Date) => acknowledgeBriefing({tenantId: 'tenant-a', operatorId: 'operator-a', now});

beforeEach(() => {
  vi.clearAllMocks();
  history = [];
  tx.userDocumentType.findFirst.mockResolvedValue({id: 'type-briefing'});
  tx.userDocument.findFirst.mockResolvedValue(null);
  tx.userDocument.create.mockResolvedValue({id: 'doc-1'});
  tx.user.findFirst.mockResolvedValue({name: 'Иван', role: 'OPERATOR', timezone: 'Europe/Moscow'});
  tx.briefingRecord.create.mockImplementation(async ({data}: {data: HistoryRow}) => {
    history.push(data);
    return {id: `rec-${history.length}`};
  });
  // Журнал ведёт себя как таблица: повтор ищется по тем же полям, по каким его
  // потом находит проверка, — сутки, вид записи и редакция инструкции.
  tx.briefingRecord.findFirst.mockImplementation(async (args: {where: {
    userId: string; kind: string; documentCode: string; documentVersion: string;
    recordedAt: {gte: Date; lt: Date};
  }}) => {
    const {where} = args;
    return history.find((row) =>
      row.userId === where.userId
      && row.kind === where.kind
      && row.documentCode === where.documentCode
      && row.documentVersion === where.documentVersion
      && row.recordedAt >= where.recordedAt.gte
      && row.recordedAt < where.recordedAt.lt,
    ) ?? null;
  });
  withReadinessTenantTransaction.mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test: фиктивный клиент транзакции вместо Prisma
    async (_tenantId: string, work: (client: any) => Promise<unknown>) => work(tx),
  );
});

describe('acknowledgeBriefing — одна отметка в сутки на редакцию инструкции', () => {
  it('два вызова в один день дают одну запись и один и тот же ответ', async () => {
    const first = await call(new Date('2026-09-26T06:00:00.000Z'));
    const second = await call(new Date('2026-09-26T07:30:00.000Z'));

    expect(first).toEqual({version: '1.0'});
    expect(second).toEqual({version: '1.0'});
    expect(tx.briefingRecord.create).toHaveBeenCalledTimes(1);
    expect(history).toHaveLength(1);
  });

  it('инструктаж следующим днём — отдельная запись', async () => {
    await call(new Date('2026-09-26T06:00:00.000Z'));
    await call(new Date('2026-09-27T06:00:00.000Z'));

    expect(tx.briefingRecord.create).toHaveBeenCalledTimes(2);
    expect(history).toHaveLength(2);
  });
});
