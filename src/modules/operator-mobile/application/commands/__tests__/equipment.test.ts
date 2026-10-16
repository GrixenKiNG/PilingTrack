// @vitest-environment node
import {beforeEach, describe, expect, it, vi} from 'vitest';

/*
  СМЕНА НЕ ОТКРЫВАЕТСЯ БЕЗ ОТМЕТКИ О ПРОВЕРКЕ СИЗ.

  До 14.10.2026 экран v10 принимал установку мимо шага СИЗ, а `acceptEquipment`
  отметки не спрашивал: смена переходила в STARTED без проверки. Нужна сама
  отметка за производственные сутки; нехватка предмета в ней остаётся
  предупреждением (`domain/ppe.ts`) и запрещает только выработку.
*/
const {withReadinessTenantTransaction, requestReadinessSnapshot} = vi.hoisted(() => ({
  withReadinessTenantTransaction: vi.fn(),
  requestReadinessSnapshot: vi.fn(),
}));
vi.mock('@/modules/readiness/server', () => ({withReadinessTenantTransaction, requestReadinessSnapshot}));

vi.mock('../shared', async () => {
  const actual = await vi.importActual<typeof import('../shared')>('../shared');
  return {
    ...actual,
    requireCrew: vi.fn(async () => ({id: 'crew-a', siteId: 'site-a'})),
    requireOpenShift: vi.fn(async () => undefined),
    recordEvidence: vi.fn(async () => undefined),
  };
});

import {acceptEquipment} from '../equipment';

const NOW = new Date('2026-10-14T06:00:00.000Z');

const tx = {
  user: {findFirst: vi.fn()},
  shift: {findFirst: vi.fn(), create: vi.fn(), update: vi.fn()},
  ppeCheck: {findFirst: vi.fn()},
  site: {findFirst: vi.fn()},
};

const accept = () => acceptEquipment({
  tenantId: 'tenant-a', operatorId: 'operator-a', equipmentId: 'equipment-a',
  shiftType: 'DAY', clientCommandId: 'cmd-1', now: NOW,
});

beforeEach(() => {
  vi.clearAllMocks();
  withReadinessTenantTransaction.mockImplementation(async (_tenant: string, work: (client: typeof tx) => unknown) => work(tx));
  tx.user.findFirst.mockResolvedValue({timezone: 'Europe/Moscow'});
  tx.shift.findFirst.mockResolvedValue(null);
  tx.shift.create.mockResolvedValue({});
  tx.shift.update.mockResolvedValue({});
  tx.site.findFirst.mockResolvedValue({latitude: null, longitude: null});
  tx.ppeCheck.findFirst.mockResolvedValue({id: 'ppe-1'});
});

describe('acceptEquipment: проверка СИЗ', () => {
  it('без отметки о проверке СИЗ смену не открывает', async () => {
    tx.ppeCheck.findFirst.mockResolvedValue(null);

    await expect(accept()).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining('средств защиты'),
    });
    expect(tx.shift.create).not.toHaveBeenCalled();
    expect(tx.shift.update).not.toHaveBeenCalled();
  });

  it('ищет отметку именно этого работника за производственные сутки в его поясе', async () => {
    await accept();

    expect(tx.ppeCheck.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {tenantId: 'tenant-a', userId: 'operator-a', productionDate: new Date('2026-10-14T00:00:00.000Z')},
    }));
  });

  it('с отметкой открывает смену', async () => {
    const result = await accept();

    expect(tx.shift.create).toHaveBeenCalledTimes(1);
    expect(tx.shift.create.mock.calls[0][0].data).toMatchObject({state: 'STARTED', equipmentId: 'equipment-a'});
    expect(result).toEqual({shiftId: expect.any(String)});
  });

  it('нехватка предмета в отметке смену не запирает: она предупреждение, а не запрет', async () => {
    tx.ppeCheck.findFirst.mockResolvedValue({id: 'ppe-1', missing: ['GLOVES']});

    await expect(accept()).resolves.toEqual({shiftId: expect.any(String)});
  });

  it('повтор команды по уже открытой смене проходит без повторной проверки СИЗ', async () => {
    tx.ppeCheck.findFirst.mockResolvedValue(null);
    tx.shift.findFirst.mockResolvedValue({
      id: 'shift-1', state: 'STARTED', productionDate: new Date('2026-10-14T00:00:00.000Z'),
      plannedStartAt: null, plannedEndAt: null,
    });

    await expect(accept()).resolves.toEqual({shiftId: 'shift-1'});
    expect(tx.ppeCheck.findFirst).not.toHaveBeenCalled();
  });
});
