// @vitest-environment node
import {beforeEach, describe, expect, it, vi} from 'vitest';

/*
  СТЫКИ СЕКЦИЙ СОСТАВНОЙ СВАИ ПИШУТСЯ ВМЕСТЕ С ПАСПОРТОМ.

  Из стыков собираются акты скрытых работ на сварку и на антикоррозионную
  обработку. Время сварки и нанесения покрытия ставит сервер: время с телефона
  было бы вторым источником правды. Стык без сварщика или электродов подписать
  нечем, поэтому команда его не принимает.
*/
const {withReadinessTenantTransaction} = vi.hoisted(() => ({withReadinessTenantTransaction: vi.fn()}));
vi.mock('@/modules/readiness/server', () => ({withReadinessTenantTransaction}));
vi.mock('@/lib/db', () => ({db: {}}));

import {logProduction} from '../production';

const now = new Date('2026-09-26T10:00:00.000Z');

const tx = {
  $executeRaw: vi.fn(),
  shift: {findFirst: vi.fn()},
  report: {findFirst: vi.fn(), upsert: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn()},
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
  pilePassport: {create: vi.fn()},
  reportAudit: {create: vi.fn()},
  user: {findFirst: vi.fn()},
};

function command(joints?: unknown[]) {
  return {
    tenantId: 'tenant-a',
    operatorId: 'operator-a',
    shiftId: 'shift-1234-5678',
    clientCommandId: 'cmd-passport-1',
    entry: {
      kind: 'PILE_PASSPORT' as const,
      pileGradeId: 'grade-1',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test: стыки подаём как есть, в том числе битые
      passport: {pileNumber: 'С-117', joints: joints as any},
    },
    now,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  tx.shift.findFirst.mockResolvedValue({
    id: 'shift-1234-5678', state: 'STARTED', equipmentId: 'equipment-1',
    productionDate: new Date('2026-09-26T00:00:00.000Z'), type: 'DAY',
    starter: {id: 'operator-a', role: 'OPERATOR'},
  });
  tx.report.findFirst.mockResolvedValue(null);
  tx.crew.findFirst.mockResolvedValue({id: 'crew-1', siteId: 'site-1'});
  tx.operatorChecklistExecution.findFirst.mockResolvedValue({startedAt: new Date('2026-09-25T09:00:00.000Z')});
  tx.userDocumentType.findMany.mockResolvedValue([]);
  tx.userDocument.findMany.mockResolvedValue([]);
  tx.ppeCheck.findFirst.mockResolvedValue(null);
  tx.equipmentDefect.findMany.mockResolvedValue([]);
  tx.safetyIncident.findMany.mockResolvedValue([]);
  tx.equipment.findFirst.mockResolvedValue({isActive: true, hammerType: 'СП-75А', hammerEnergyKj: 60});
  tx.pileGrade.findFirst.mockResolvedValue({id: 'grade-1', lengthMm: 24000, name: 'С240.35', isActive: true, archivedAt: null});
  tx.pileWork.findUnique.mockResolvedValue(null);
  tx.pileWork.create.mockResolvedValue({id: 'pw-1'});
  tx.pilePassport.create.mockResolvedValue({});
  tx.report.upsert.mockResolvedValue({id: 'report-pk-1'});
  tx.report.findUnique.mockResolvedValue({status: 'draft'});
  tx.report.findUniqueOrThrow.mockResolvedValue({reportId: 'RM-1'});
  tx.reportAudit.create.mockResolvedValue({});
  tx.user.findFirst.mockResolvedValue({name: 'Иванов', role: 'OPERATOR'});
  withReadinessTenantTransaction.mockImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test: фиктивный клиент транзакции вместо Prisma
    async (_tenantId: string, work: (client: any) => Promise<unknown>) => work(tx),
  );
});

describe('logProduction — стыки составной сваи', () => {
  it('пишет стыки вместе с паспортом, нумерует по порядку и ставит время сам', async () => {
    await logProduction(command([
      {welderName: ' Петров П. П. ', electrode: 'УОНИ-13/55', anticorrosionMaterial: 'ВЛ-515'},
      {welderName: 'Петров П. П.', electrode: 'УОНИ-13/55'},
    ]));

    const {data} = tx.pilePassport.create.mock.calls[0][0];
    expect(data.joints.create).toEqual([
      {tenantId: 'tenant-a', ordinal: 1, weldedAt: now, welderName: 'Петров П. П.', electrode: 'УОНИ-13/55',
        anticorrosionMaterial: 'ВЛ-515', anticorrosionAt: now},
      {tenantId: 'tenant-a', ordinal: 2, weldedAt: now, welderName: 'Петров П. П.', electrode: 'УОНИ-13/55',
        anticorrosionMaterial: null, anticorrosionAt: null},
    ]);
  });

  it('обычная свая пишется без стыков', async () => {
    await logProduction(command());

    expect(tx.pilePassport.create.mock.calls[0][0].data.joints).toBeUndefined();
  });

  it('стык без сварщика или электродов отклоняется 400 и ничего не пишет', async () => {
    await expect(logProduction(command([{welderName: '  ', electrode: 'УОНИ-13/55'}])))
      .rejects.toMatchObject({status: 400});
    await expect(logProduction(command([{welderName: 'Петров', electrode: ''}])))
      .rejects.toMatchObject({status: 400});

    expect(tx.pilePassport.create).not.toHaveBeenCalled();
  });
});
