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

import {logProduction} from '../production';

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
