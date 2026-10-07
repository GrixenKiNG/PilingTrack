/**
 * listAllEquipment — operator scope regression test.
 *
 * Guards the ACL fix from 2026-04: operators must only see equipment they
 * are crew-assigned to (via an active crew). Without operatorUserId, all
 * equipment is returned (admin/dispatcher view).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  findManyMock, findManyRecMock, findUniqueRecMock, equipmentUniqueMock, equipmentCountMock,
  reportFindManyMock, analyticsFindManyMock, inspectionFirstMock,
  meterReadingFindManyMock, meterReadingFirstMock, fuelLogFindManyMock, fuelLogFirstMock, planFindManyMock,
} = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  findManyRecMock: vi.fn(),
  findUniqueRecMock: vi.fn(),
  equipmentUniqueMock: vi.fn(),
  equipmentCountMock: vi.fn(),
  reportFindManyMock: vi.fn(),
  analyticsFindManyMock: vi.fn(),
  inspectionFirstMock: vi.fn(),
  meterReadingFindManyMock: vi.fn(),
  meterReadingFirstMock: vi.fn(),
  fuelLogFindManyMock: vi.fn(),
  fuelLogFirstMock: vi.fn(),
  planFindManyMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    equipment: { findMany: findManyMock, findUnique: equipmentUniqueMock, count: equipmentCountMock },
    report: { findMany: reportFindManyMock },
    reportAnalytics: { findMany: analyticsFindManyMock },
    inspection: { findFirst: inspectionFirstMock },
    maintenanceRecord: { findMany: findManyRecMock, findUnique: findUniqueRecMock },
    meterReading: { findMany: meterReadingFindManyMock, findFirst: meterReadingFirstMock },
    fuelLog: { findMany: fuelLogFindManyMock, findFirst: fuelLogFirstMock },
    maintenancePlan: { findMany: planFindManyMock },
  },
}));

import {
  listAllEquipment,
  listMeterReadings,
  listFuelLog,
  getFuelSummary,
  listMaintenance,
  listMaintenancePlans,
  getFleetKpiData,
} from '../equipment-query.service';

describe('listAllEquipment — operator scope', () => {
  beforeEach(() => {
    findManyMock.mockReset();
    findManyMock.mockResolvedValue([]);
  });

  it('returns all equipment when no operatorUserId is passed', async () => {
    await listAllEquipment('orion');
    const args = findManyMock.mock.calls[0][0];
    expect(args.where).toEqual({ tenantId: 'orion' });
    expect(args.select.updatedAt).toBe(true);
  });

  it('filters by active crew assignment when operatorUserId is provided', async () => {
    await listAllEquipment('orion', undefined, null, 'user_op_42');
    const args = findManyMock.mock.calls[0][0];
    expect(args.where).toEqual({
      tenantId: 'orion',
      crews: { some: { isActive: true, operatorId: 'user_op_42' } },
    });
  });

  it('narrows operator scope further when siteId is provided', async () => {
    await listAllEquipment('orion', undefined, 'site_1', 'user_op_42');
    const args = findManyMock.mock.calls[0][0];
    expect(args.where).toEqual({
      tenantId: 'orion',
      crews: {
        some: { isActive: true, operatorId: 'user_op_42', siteId: 'site_1' },
      },
    });
  });

  it('does NOT add operator filter when operatorUserId is null', async () => {
    // Regression guard: passing null (admin path) must not accidentally
    // produce a `crews.some` filter that would silently hide equipment.
    await listAllEquipment('orion', undefined, 'site_1', null);
    const args = findManyMock.mock.calls[0][0];
    expect(args.where).toEqual({ tenantId: 'orion' });
  });

  // Раньше тенант был необязательным и применялся через `if (tenantId)`:
  // при пустом значении условие исчезало, и в ответ уходила техника всех
  // организаций. Проверки ниже требуют отказа, а не общей выборки.
  describe('без тенанта запрос не выполняется', () => {
    it.each([
      ['не передан', undefined],
      ['null', null],
      ['пустая строка', ''],
      ['одни пробелы', '   '],
    ])('%s — отказ, а не список всех организаций', async (_label, tenantId) => {
      await expect(listAllEquipment(tenantId as string | null | undefined)).rejects.toThrow(
        'Контекст организации не определён',
      );
      expect(findManyMock).not.toHaveBeenCalled();
    });
  });
});

describe('listAllMaintenance', () => {
  it('scopes by tenantId and applies status filter', async () => {
    findManyRecMock.mockResolvedValue([{ id: 'rec_1' }]);
    const { listAllMaintenance } = await import('../equipment-query.service');
    await listAllMaintenance('orion', { status: 'PLANNED' });

    const arg = findManyRecMock.mock.calls[0][0];
    expect(arg.where.tenantId).toBe('orion');
    expect(arg.where.status).toBe('PLANNED');
  });

  it('throws when tenantId is empty (fail-closed)', async () => {
    const { listAllMaintenance } = await import('../equipment-query.service');
    await expect(listAllMaintenance('', {})).rejects.toThrow();
  });

  it('applies only tenantId when no filters given', async () => {
    findManyRecMock.mockResolvedValue([]);
    const { listAllMaintenance } = await import('../equipment-query.service');
    await listAllMaintenance('orion');
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test: value is established by the setup/fixture above
    const arg = findManyRecMock.mock.calls.at(-1)![0];
    expect(arg.where).toEqual({ tenantId: 'orion' });
  });

  it('applies priority and assigneeId filters when given', async () => {
    findManyRecMock.mockResolvedValue([]);
    const { listAllMaintenance } = await import('../equipment-query.service');
    await listAllMaintenance('orion', { priority: 'HIGH', assigneeId: 'usr_3' });
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- test: value is established by the setup/fixture above
    const arg = findManyRecMock.mock.calls.at(-1)![0];
    expect(arg.where.priority).toBe('HIGH');
    expect(arg.where.assigneeId).toBe('usr_3');
  });
});

describe('getMaintenanceById', () => {
  it('returns the record when tenant matches', async () => {
    findUniqueRecMock.mockResolvedValue({ id: 'rec_1', tenantId: 'orion', equipmentId: 'eq_1' });
    const { getMaintenanceById } = await import('../equipment-query.service');
    const rec = await getMaintenanceById('rec_1', 'orion');
    expect(rec.id).toBe('rec_1');
  });
  it('throws 404 for cross-tenant record', async () => {
    findUniqueRecMock.mockResolvedValue({ id: 'rec_1', tenantId: 'other', equipmentId: 'eq_1' });
    const { getMaintenanceById } = await import('../equipment-query.service');
    await expect(getMaintenanceById('rec_1', 'orion')).rejects.toThrow('Запись ТО не найдена');
  });
  it('throws when tenantId empty (fail-closed)', async () => {
    const { getMaintenanceById } = await import('../equipment-query.service');
    await expect(getMaintenanceById('rec_1', '')).rejects.toThrow();
  });
  it('throws 404 when not found', async () => {
    findUniqueRecMock.mockResolvedValue(null);
    const { getMaintenanceById } = await import('../equipment-query.service');
    await expect(getMaintenanceById('missing', 'orion')).rejects.toThrow('Запись ТО не найдена');
  });
});

function detailReport(index: number, date = '2026-10-01') {
  return {
    id: 'cuid-' + index, reportId: 'uuid-' + index, date, shiftType: 'DAY', status: 'submitted',
    site: { id: 'site-1', name: 'Site' }, user: { id: 'operator-1', name: 'Operator' },
    piles: [{ count: 2, pileGrade: { name: 'Grade', lengthMm: 12_000 } }],
    drillings: [{ count: 3, meters: 18 }], downtimes: [{ duration: 1.5 }],
    updatedAt: new Date('2026-10-01T10:00:00Z'),
  };
}

describe('getEquipmentDetails — complete 30-day stats with existing history cap', () => {
  let reports: ReturnType<typeof detailReport>[];

  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-10-02T10:00:00Z').getTime());
    reports = [];
    equipmentUniqueMock.mockReset().mockResolvedValue({ id: 'equipment-1', crews: [], telematicsDevices: [], documents: [] });
    inspectionFirstMock.mockReset().mockResolvedValue(null);
    analyticsFindManyMock.mockReset().mockResolvedValue([]);
    reportFindManyMock.mockReset().mockImplementation(async ({ where, take }: {
      where: { equipmentId: string; date?: { gte: string }; status?: string }; take?: number;
    }) => {
      const matching = reports.filter(report => (!where.date || report.date >= where.date.gte) && (!where.status || report.status === where.status))
        .sort((a, b) => b.date.localeCompare(a.date));
      return take === undefined ? matching : matching.slice(0, take);
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('counts more than 1000 recent reports while preserving latest-1000 history', async () => {
    reports = Array.from({ length: 1001 }, (_, index) => detailReport(index));
    analyticsFindManyMock.mockResolvedValue(reports.map(report => ({
      reportId: report.reportId, totalPiles: 2, totalDrilling: 18, totalDowntime: 1.5,
    })));
    const { getEquipmentDetails } = await import('../equipment-query.service');
    const details = await getEquipmentDetails('equipment-1', 'orion');
    expect(details.stats30d).toEqual({ reportCount: 1001, piles: 2002, pileMeters: 24024, drillingCount: 3003, drillingMeters: 18018, downtimeHours: 1501.5 });
    expect(details.timeline).toHaveLength(1000);
    expect(reportFindManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { equipmentId: 'equipment-1', date: { gte: '2026-09-02' }, status: 'submitted' },
    }));
    const statsQuery = reportFindManyMock.mock.calls.find(([arg]) => arg.where.date);
    expect(statsQuery?.[0]).not.toHaveProperty('take');
    expect(analyticsFindManyMock.mock.calls[0][0].where.reportId.in).toContain('uuid-1000');
  });

  it('uses source totals only when projection is missing, including units and signed corrections', async () => {
    const report = detailReport(1);
    report.piles.push({ count: -1, pileGrade: { name: 'Grade', lengthMm: 12_000 } });
    report.drillings.push({ count: -1, meters: -4 });
    report.downtimes.push({ duration: -0.5 });
    reports = [report];
    const { getEquipmentDetails } = await import('../equipment-query.service');
    const details = await getEquipmentDetails('equipment-1', 'orion');
    expect(details.stats30d).toEqual({ reportCount: 1, piles: 1, pileMeters: 12, drillingCount: 2, drillingMeters: 14, downtimeHours: 1 });
    expect(details.timeline[0]).toMatchObject({ piles: 1, drillingMeters: 14, downtimeHours: 1 });
  });

  it('prefers source totals over an existing projection that differs from current source (J6)', async () => {
    reports = [detailReport(7)];
    analyticsFindManyMock.mockResolvedValue([{ reportId: 'uuid-7', totalPiles: 0, totalDrilling: 0, totalDowntime: 0 }]);
    const { getEquipmentDetails } = await import('../equipment-query.service');
    const details = await getEquipmentDetails('equipment-1', 'orion');
    // Проекция занулена, но источник жив: карточка показывает работы, а не 0.
    expect(details.stats30d).toEqual({ reportCount: 1, piles: 2, pileMeters: 24, drillingCount: 3, drillingMeters: 18, downtimeHours: 1.5 });
    expect(details.timeline[0]).toMatchObject({ piles: 2, drillingMeters: 18, downtimeHours: 1.5 });
    expect(analyticsFindManyMock.mock.calls[0][0].where.reportId.in).toEqual(['uuid-7']);
  });

  it('J6: сданный отчёт с нулевой проекцией берёт итоги из источника', async () => {
    reports = [detailReport(7)];
    analyticsFindManyMock.mockResolvedValue([{ reportId: 'uuid-7', totalPiles: 0, totalDrilling: 0, totalDowntime: 0 }]);
    const { getEquipmentDetails } = await import('../equipment-query.service');
    const details = await getEquipmentDetails('equipment-1', 'orion');
    expect(details.stats30d.piles).toBe(2);
    expect(details.stats30d.drillingMeters).toBe(18);
    expect(details.stats30d.downtimeHours).toBe(1.5);
    expect(details.timeline[0]).toMatchObject({ piles: 2, drillingMeters: 18, downtimeHours: 1.5 });
  });

  it('keeps the inclusive UTC cutoff, future submitted reports', async () => {
    reports = [detailReport(1, '2026-09-01'), detailReport(2, '2026-09-02'), detailReport(3, '2026-10-03')];
    const { getEquipmentDetails } = await import('../equipment-query.service');
    const details = await getEquipmentDetails('equipment-1', 'orion');
    expect(details.stats30d.reportCount).toBe(2);
    expect(details.stats30d.piles).toBe(4);
    expect(details.timeline).toHaveLength(3);
    expect(details.timeline.every(report => report.status === 'submitted')).toBe(true);
  });

  it('I05: retains labelled drafts in history but counts them only after submission', async () => {
    const report = detailReport(1);
    report.status = 'draft';
    reports = [report];
    const { getEquipmentDetails } = await import('../equipment-query.service');
    const draft = await getEquipmentDetails('equipment-1', 'orion');
    expect(draft.stats30d).toEqual({ reportCount: 0, piles: 0, pileMeters: 0, drillingCount: 0, drillingMeters: 0, downtimeHours: 0 });
    expect(draft.timeline).toHaveLength(1);
    expect(draft.timeline[0]).toMatchObject({ status: 'draft', piles: 2 });
    report.status = 'submitted';
    const submitted = await getEquipmentDetails('equipment-1', 'orion');
    expect(submitted.stats30d).toEqual({ reportCount: 1, piles: 2, pileMeters: 24, drillingCount: 3, drillingMeters: 18, downtimeHours: 1.5 });
  });

  it('reports actual source zero instead of missing projection null for an empty report', async () => {
    const report = detailReport(1);
    report.piles = [];
    report.drillings = [];
    report.downtimes = [];
    reports = [report];
    const { getEquipmentDetails } = await import('../equipment-query.service');
    const details = await getEquipmentDetails('equipment-1', 'orion');
    expect(details.stats30d).toEqual({ reportCount: 1, piles: 0, pileMeters: 0, drillingCount: 0, drillingMeters: 0, downtimeHours: 0 });
    expect(details.timeline[0]).toMatchObject({ piles: 0, drillingMeters: 0, downtimeHours: 0 });
  });
});

/**
 * W52: fail-closed гварды тенанта (`if (!tenantId) throw`) в листингах
 * equipment-query не выполнялись ни одним тестом, хотя это IDOR-защита:
 * пустой tenantId не должен молча снимать фильтр организации.
 */
describe('equipment-query — tenant fail-closed guards (W52)', () => {
  beforeEach(() => {
    meterReadingFindManyMock.mockReset().mockResolvedValue([]);
    meterReadingFirstMock.mockReset().mockResolvedValue(null);
    fuelLogFindManyMock.mockReset().mockResolvedValue([]);
    fuelLogFirstMock.mockReset().mockResolvedValue(null);
    planFindManyMock.mockReset().mockResolvedValue([]);
    equipmentCountMock.mockReset().mockResolvedValue(0);
    findManyRecMock.mockReset().mockResolvedValue([]);
    equipmentUniqueMock.mockReset().mockResolvedValue(null);
  });

  it.each([
    ['listMeterReadings', () => listMeterReadings('eq-1', ''), meterReadingFindManyMock],
    ['listFuelLog', () => listFuelLog('eq-1', ''), fuelLogFindManyMock],
    ['getFuelSummary', () => getFuelSummary('eq-1', '', new Date('2026-10-01'), new Date('2026-10-07')), equipmentUniqueMock],
    ['listMaintenancePlans', () => listMaintenancePlans(''), planFindManyMock],
    ['getFleetKpiData', () => getFleetKpiData('', new Date('2026-10-01'), new Date('2026-10-07')), findManyRecMock],
  ])('%s: пустой tenantId → ServiceError, запрос к базе не выполнен', async (_name, call, dbSpy) => {
    await expect(call()).rejects.toThrow('Не определена организация пользователя');
    expect(dbSpy).not.toHaveBeenCalled();
  });

  /**
   * Дефект, вскрытый этим тестом (не чиним — вне задачи): в отличие от
   * остальных листингов, `listMaintenance` не имеет гварда `if (!tenantId)`,
   * хотя назван в задаче W52. С пустым tenantId он уходит в базу.
   */
  it.fails('listMaintenance: пустой tenantId → отказ (гварда нет — дефект)', async () => {
    await expect(listMaintenance('eq-1', '')).rejects.toThrow('Не определена организация пользователя');
    expect(findManyRecMock).not.toHaveBeenCalled();
  });

  it('listMeterReadings: непустой tenantId фильтрует по нему и передаёт лимит', async () => {
    await listMeterReadings('eq-1', 'orion', 10);
    expect(meterReadingFindManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { equipmentId: 'eq-1', tenantId: 'orion' },
      take: 10,
    }));
  });

  it('listFuelLog: непустой tenantId фильтрует по нему', async () => {
    await listFuelLog('eq-1', 'orion');
    expect(fuelLogFindManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { equipmentId: 'eq-1', tenantId: 'orion' },
    }));
  });

  it('listMaintenance: непустой tenantId фильтрует по нему', async () => {
    await listMaintenance('eq-1', 'orion');
    expect(findManyRecMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { equipmentId: 'eq-1', tenantId: 'orion' },
    }));
  });

  it('listMaintenancePlans: непустой tenantId фильтрует по нему', async () => {
    await listMaintenancePlans('orion');
    expect(planFindManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 'orion' },
    }));
  });
});