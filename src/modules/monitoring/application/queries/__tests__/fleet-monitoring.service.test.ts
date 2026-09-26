/**
 * Regression: fleet snapshot must scope equipment by tenant.
 *
 * The equipment query once filtered only on `isActive` (and optional crew),
 * never on `tenantId`, so a dispatcher/admin would see every tenant's rigs
 * once a second tenant existed (latent cross-tenant leak). These tests pin
 * the tenant filter onto the equipment query.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Смены и наряды читает общее правило состояния установки
// (@/modules/equipment): «работает» — это открытая смена, «в ремонте» —
// открытая неисправность. Раньше состояние выводилось из наличия отчёта за
// сегодня, и работающая с утра машина числилась стоящей до сдачи отчёта.
const {
  equipmentFindMany, reportFindMany, analyticsFindMany, mediaFindMany,
  shiftFindMany, maintenanceFindMany,
} = vi.hoisted(() => ({
  equipmentFindMany: vi.fn(),
  reportFindMany: vi.fn(),
  analyticsFindMany: vi.fn(),
  mediaFindMany: vi.fn(),
  // Форма задана явно: без неё реализация по умолчанию сужает тип до
  // Promise<never[]>, и тест, подставляющий строку смены или наряда, не
  // компилируется.
  shiftFindMany: vi.fn((): Promise<Array<{ equipmentId: string }>> => Promise.resolve([])),
  maintenanceFindMany: vi.fn((): Promise<Array<{ equipmentId: string }>> => Promise.resolve([])),
}));

vi.mock('@/lib/db', () => ({
  db: {
    equipment: { findMany: equipmentFindMany },
    report: { findMany: reportFindMany },
    reportAnalytics: { findMany: analyticsFindMany },
    media: { findMany: mediaFindMany },
    shift: { findMany: shiftFindMany },
    maintenanceRecord: { findMany: maintenanceFindMany },
  },
}));

import { getFleetSnapshot } from '../fleet-monitoring.service';

describe('getFleetSnapshot — tenant isolation', () => {
  beforeEach(() => {
    equipmentFindMany.mockReset();
    reportFindMany.mockReset();
    analyticsFindMany.mockReset();
    shiftFindMany.mockReset().mockResolvedValue([]);
    maintenanceFindMany.mockReset().mockResolvedValue([]);
    // Empty equipment → early return; we only assert the query's where clause.
    equipmentFindMany.mockResolvedValue([]);
    reportFindMany.mockResolvedValue([]);
    shiftFindMany.mockResolvedValue([{ equipmentId: 'eq-1' }]);
    analyticsFindMany.mockResolvedValue([]);
  });

  it('filters equipment by tenantId', async () => {
    await getFleetSnapshot({ tenantId: 'orion' });

    expect(equipmentFindMany).toHaveBeenCalledTimes(1);
    const where = equipmentFindMany.mock.calls[0][0].where;
    expect(where.tenantId).toBe('orion');
  });

  it('keeps operator crew scoping alongside the tenant filter', async () => {
    await getFleetSnapshot({ tenantId: 'orion', operatorUserId: 'op-1' });

    const where = equipmentFindMany.mock.calls[0][0].where;
    expect(where.tenantId).toBe('orion');
    expect(where.crews).toBeDefined();
  });

  // Defence-in-depth, symmetric with getEquipmentAnalytics: the type says
  // tenantId is a non-empty string and the route fails closed, but a falsy
  // tenant ('') would make Prisma match nothing and silently return an empty
  // fleet. Fail loud at the boundary instead.
  it('throws on an empty tenantId instead of querying', async () => {
    await expect(getFleetSnapshot({ tenantId: '' })).rejects.toThrow(/tenantId/i);

    expect(equipmentFindMany).not.toHaveBeenCalled();
  });
});

describe('getFleetSnapshot — inventory fields and operators on shift', () => {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });

  beforeEach(() => {
    equipmentFindMany.mockReset();
    reportFindMany.mockReset();
    analyticsFindMany.mockReset();
    mediaFindMany.mockReset();
    analyticsFindMany.mockResolvedValue([]);
    mediaFindMany.mockResolvedValue([]);
  });

  it('maps inventory fields onto the card and serializes the maintenance date', async () => {
    const due = new Date('2026-07-01T00:00:00.000Z');
    equipmentFindMany.mockResolvedValue([
      {
        id: 'eq-1', name: 'PVE 50PR', model: 'PVE', manufactureYear: 2019,
        kind: 'PILE_DRIVER', inventoryNumber: 'ИНВ-1001', serialNumber: '50PR-1142',
        engineHoursTotal: 8450, nextMaintenanceDate: due, nextMaintenanceAtHours: 9000,
        crews: [],
      },
    ]);
    reportFindMany.mockResolvedValue([]);

    const snap = await getFleetSnapshot({ tenantId: 'orion' });
    const card = snap.equipment[0];

    expect(card.kind).toBe('PILE_DRIVER');
    expect(card.inventoryNumber).toBe('ИНВ-1001');
    expect(card.serialNumber).toBe('50PR-1142');
    expect(card.engineHoursTotal).toBe(8450);
    expect(card.nextMaintenanceDate).toBe(due.toISOString());
    expect(card.nextMaintenanceAtHours).toBe(9000);
    // No reports → idle, no today totals.
    expect(card.status).toBe('idle');
    expect(card.todayTotals).toBeNull();
  });

  it('counts distinct operators with a report today', async () => {
    equipmentFindMany.mockResolvedValue([
      {
        id: 'eq-1', name: 'A', model: '', manufactureYear: null, kind: 'OTHER',
        inventoryNumber: null, serialNumber: null, engineHoursTotal: null,
        nextMaintenanceDate: null, nextMaintenanceAtHours: null, crews: [],
      },
    ]);
    reportFindMany.mockResolvedValue([
      { id: 'r1', reportId: 'R1', equipmentId: 'eq-1', crewId: 'c1', userId: 'u1', date: today, shiftType: 'DAY', updatedAt: new Date(), user: { name: 'Иванов' }, site: { name: 'Объект' } },
      { id: 'r2', reportId: 'R2', equipmentId: 'eq-1', crewId: 'c1', userId: 'u2', date: today, shiftType: 'NIGHT', updatedAt: new Date(), user: { name: 'Петров' }, site: { name: 'Объект' } },
      { id: 'r3', reportId: 'R3', equipmentId: 'eq-1', crewId: 'c1', userId: 'u1', date: today, shiftType: 'DAY', updatedAt: new Date(), user: { name: 'Иванов' }, site: { name: 'Объект' } },
    ]);

    const snap = await getFleetSnapshot({ tenantId: 'orion' });

    expect(snap.totals.operatorsOnShiftToday).toBe(2);
  });

  it('builds a production FleetCard with assignment, work totals, statuses, and downtime reason', async () => {
    equipmentFindMany.mockResolvedValue([
      {
        id: 'eq-1',
        name: 'LRH-100 №2',
        model: 'LRH-100',
        manufactureYear: 2022,
        kind: 'PILE_DRIVER',
        inventoryNumber: 'PT-LRH-002',
        serialNumber: '18-07',
        engineHoursTotal: 1248,
        nextMaintenanceDate: null,
        nextMaintenanceAtHours: 1300,
        crews: [
          {
            name: 'Бригада Андреева',
            operator: { name: 'Иван Петров' },
            site: { id: 'site-1', name: 'ЖК Северный' },
          },
        ],
        maintenanceRecords: [],
      },
    ]);
    reportFindMany.mockResolvedValue([
      {
        id: 'r1',
        reportId: 'R-1248',
        equipmentId: 'eq-1',
        crewId: 'crew-1',
        userId: 'op-1',
        date: today,
        shiftType: 'DAY',
        updatedAt: new Date('2026-06-20T08:12:00.000Z'),
        piles: [{ count: 18, pileGrade: { name: 'Свая 070', lengthMm: 7000 } }],
        drillings: [{ count: 6, meters: 42 }],
        downtimes: [
          { duration: 1.5, comment: 'ожидание бетона', reason: { name: 'Ожидание' } },
          { duration: 0.5, comment: null, reason: { name: 'Перестановка' } },
        ],
        user: { name: 'Иван Петров' },
        site: { name: 'ЖК Северный' },
      },
    ]);
    analyticsFindMany.mockResolvedValue([
      { reportId: 'R-1248', totalPiles: 18, totalDrilling: 42, totalDowntime: 2 },
    ]);

    const snap = await getFleetSnapshot({ tenantId: 'orion' });
    const card = snap.equipment[0];

    expect(card.assignedSiteId).toBe('site-1');
    expect(card.assignedSiteName).toBe('ЖК Северный');
    expect(card.assignedCrewName).toBe('Бригада Андреева');
    expect(card.assignedOperatorName).toBe('Иван Петров');
    expect(card.reportStatus).toBe('has_report');
    // «Работает» теперь означает открытую смену, а не сданный отчёт: смену
    // задаёт shiftFindMany ниже по фикстуре.
    expect(card.equipmentStatus).toBe('working');
    expect(card.todayTotals).toEqual({
      piles: 18,
      pileMeters: 126,
      drillingCount: 6,
      drillingMeters: 42,
      downtimeHours: 2,
    });
    expect(card.downtimeReason).toBe('Ожидание: ожидание бетона');
  });

  it('marks equipment as repair when an active repair maintenance record exists', async () => {
    equipmentFindMany.mockResolvedValue([
      {
        id: 'eq-1',
        name: 'Bauer BG 24',
        model: 'BG 24',
        manufactureYear: null,
        kind: 'DRILLING_RIG',
        inventoryNumber: null,
        serialNumber: null,
        engineHoursTotal: null,
        nextMaintenanceDate: null,
        nextMaintenanceAtHours: null,
        crews: [],
      },
    ]);
    reportFindMany.mockResolvedValue([]);
    maintenanceFindMany.mockResolvedValue([{ equipmentId: 'eq-1' }]);

    const snap = await getFleetSnapshot({ tenantId: 'orion' });

    expect(snap.equipment[0].equipmentStatus).toBe('repair');
    expect(snap.equipment[0].reportStatus).toBe('missing');
  });

  it('resolves photoUrl from the latest completed equipment media', async () => {
    equipmentFindMany.mockResolvedValue([
      {
        id: 'eq-1', name: 'A', model: '', manufactureYear: null, kind: 'OTHER',
        inventoryNumber: null, serialNumber: null, engineHoursTotal: null,
        nextMaintenanceDate: null, nextMaintenanceAtHours: null, crews: [],
        maintenanceRecords: [],
      },
      {
        id: 'eq-2', name: 'B', model: '', manufactureYear: null, kind: 'OTHER',
        inventoryNumber: null, serialNumber: null, engineHoursTotal: null,
        nextMaintenanceDate: null, nextMaintenanceAtHours: null, crews: [],
        maintenanceRecords: [],
      },
    ]);
    reportFindMany.mockResolvedValue([]);
    // One bounded query per machine (`take: 1`, `createdAt desc`): the newest
    // completed photo of each is what the card renders. Earlier the whole
    // park's photo table was read and deduplicated in JS (F-R20-2).
    mediaFindMany.mockImplementation(
      (args: { where: { entityId: string }; take?: number }) =>
        Promise.resolve(
          args.where.entityId === 'eq-1'
            ? [
                { id: 'media-1', entityId: 'eq-1', cdnUrl: 'https://cdn.example.com/photo.jpg', thumbnailKey: 'media-1.thumb.jpg', createdAt: new Date('2026-06-15T00:00:00.000Z') },
              ]
            : [
                { id: 'media-3', entityId: 'eq-2', cdnUrl: null, thumbnailKey: 'media-3.thumb.jpg', createdAt: new Date('2026-06-10T00:00:00.000Z') },
              ],
        ),
    );

    const snap = await getFleetSnapshot({ tenantId: 'orion' });

    expect(mediaFindMany).toHaveBeenCalledTimes(2);
    const call = mediaFindMany.mock.calls[0][0];
    expect(call.where.entityType).toBe('equipment');
    expect(call.where.tenantId).toBe('orion');
    expect(call.where.uploadStatus).toBe('completed');
    expect(call.where.isDeleted).toBe(false);
    expect(call.take).toBe(1);
    expect(call.orderBy).toEqual({ createdAt: 'desc' });
    expect(mediaFindMany.mock.calls.map((c) => c[0].where.entityId)).toEqual(['eq-1', 'eq-2']);

    const eq1 = snap.equipment.find((c) => c.id === 'eq-1');
    const eq2 = snap.equipment.find((c) => c.id === 'eq-2');
    expect(eq1?.photoUrl).toBe('https://cdn.example.com/photo.jpg');
    expect(eq2?.photoUrl).toBe('/api/media/media-3/download?thumb=1');
  });
});
