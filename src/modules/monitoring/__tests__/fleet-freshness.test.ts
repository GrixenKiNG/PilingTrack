/**
 * Свежесть парка: /monitoring решает «работает / ждём отчёт / простой» по
 * календарю отчётов (active = отчёт за сегодня, expected = отчёт за последние
 * 2 дня, idle = 3+ дня без отчёта). Пороги держат диспетчера: ошибка в границе
 * покажет вчерашнюю смену «в простое», а недельной давности — «ждём отчёт».
 *
 * Раньше состояние выводилось из наличия отчёта за сегодня, а проекция
 * аналитики могла быть ещё не готова — отчёт тогда пропускался целиком, и
 * работавшая машина показывала активность с нулевыми итогами. Здесь пиннятся
 * границы порогов, пустой парк и итоги по сырым строкам, когда проекции нет.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  equipmentFindMany, reportFindMany, analyticsFindMany, mediaFindMany,
  shiftFindMany, maintenanceFindMany,
} = vi.hoisted(() => ({
  equipmentFindMany: vi.fn(),
  reportFindMany: vi.fn(),
  analyticsFindMany: vi.fn(),
  mediaFindMany: vi.fn(),
  // Форма задана явно: без аннотации вывод сужается до Promise<never[]>,
  // и разбор открытых смен/ремонтов в тесте не компилируется.
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

import { getFleetSnapshot } from '../application/queries/fleet-monitoring.service';

const FLEET_TZ = 'Europe/Moscow';
const ymd = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: FLEET_TZ });
const daysAgo = (n: number) => ymd(new Date(Date.now() - n * 86_400_000));

function equipment(id: string) {
  return {
    id, name: id, model: '', manufactureYear: null, kind: 'OTHER',
    inventoryNumber: null, serialNumber: null, engineHoursTotal: null,
    nextMaintenanceDate: null, nextMaintenanceAtHours: null, crews: [],
  };
}

function report(id: string, equipmentId: string, date: string) {
  return {
    id, reportId: id, equipmentId, crewId: null, userId: null, date,
    shiftType: 'DAY', updatedAt: new Date(),
    piles: [], drillings: [], downtimes: [], user: null, site: null,
  };
}

describe('getFleetSnapshot — пороги свежести active/expected/idle', () => {
  beforeEach(() => {
    equipmentFindMany.mockReset();
    reportFindMany.mockReset();
    analyticsFindMany.mockReset().mockResolvedValue([]);
    mediaFindMany.mockReset().mockResolvedValue([]);
    shiftFindMany.mockReset().mockResolvedValue([]);
    maintenanceFindMany.mockReset().mockResolvedValue([]);
  });

  it('держит границу: сегодня — active, 1–2 дня — expected, 3+ — idle', async () => {
    const today = ymd(new Date());
    equipmentFindMany.mockResolvedValue([
      equipment('eq-today'), equipment('eq-1d'), equipment('eq-2d'),
      equipment('eq-3d'), equipment('eq-7d'),
    ]);
    reportFindMany.mockResolvedValue([
      report('r-today', 'eq-today', today),
      report('r-1d', 'eq-1d', daysAgo(1)),
      report('r-2d', 'eq-2d', daysAgo(2)),
      report('r-3d', 'eq-3d', daysAgo(3)),
      report('r-7d', 'eq-7d', daysAgo(7)),
    ]);

    const snap = await getFleetSnapshot({ tenantId: 'orion' });
    const byId = Object.fromEntries(snap.equipment.map((c) => [c.id, c]));

    expect(byId['eq-today'].status).toBe('active');
    expect(byId['eq-today'].reportStatus).toBe('has_report');
    expect(byId['eq-today'].todaysReports).toBe(1);

    // Отчёт 1–2 дня назад — ещё «ждём отчёт», не простой.
    expect(byId['eq-1d'].status).toBe('expected');
    expect(byId['eq-1d'].reportStatus).toBe('expected');
    expect(byId['eq-2d'].status).toBe('expected');

    // 3 дня и больше без отчёта — простой; итогов за сегодня нет.
    expect(byId['eq-3d'].status).toBe('idle');
    expect(byId['eq-3d'].reportStatus).toBe('missing');
    expect(byId['eq-7d'].status).toBe('idle');
    expect(byId['eq-3d'].todayTotals).toBeNull();
    expect(byId['eq-3d'].todaysReports).toBe(0);

    expect(snap.totals.totalEquipment).toBe(5);
    expect(snap.totals.activeToday).toBe(1);
    expect(snap.totals.expected).toBe(2);
    expect(snap.totals.idle).toBe(2);
    expect(snap.today).toBe(today);
  });
});

describe('getFleetSnapshot — отсутствие данных', () => {
  beforeEach(() => {
    equipmentFindMany.mockReset();
    reportFindMany.mockReset();
    analyticsFindMany.mockReset().mockResolvedValue([]);
    mediaFindMany.mockReset().mockResolvedValue([]);
    shiftFindMany.mockReset().mockResolvedValue([]);
    maintenanceFindMany.mockReset().mockResolvedValue([]);
  });

  it('на пустом парке отдаёт нулевые итоги, а не undefined', async () => {
    equipmentFindMany.mockResolvedValue([]);

    const snap = await getFleetSnapshot({ tenantId: 'orion' });

    expect(snap.equipment).toEqual([]);
    expect(snap.totals).toEqual({
      totalEquipment: 0, workingNow: 0, activeToday: 0, expected: 0, idle: 0,
      pilesToday: 0, pileMetersToday: 0, drillingToday: 0, drillingCountToday: 0,
      downtimeHoursToday: 0, crewsOnShiftToday: 0, operatorsOnShiftToday: 0,
    });
    expect(snap.today).toBe(ymd(new Date()));
  });

  it('считает итоги по сырым строкам, когда проекции аналитики ещё нет', async () => {
    const today = ymd(new Date());
    equipmentFindMany.mockResolvedValue([equipment('eq-1')]);
    reportFindMany.mockResolvedValue([
      {
        ...report('r1', 'eq-1', today),
        piles: [{ count: 4, pileGrade: { name: 'С-40', lengthMm: 12000 } }],
        drillings: [{ count: 3, meters: 21 }],
        downtimes: [{ duration: 1.5, comment: 'ожидание бетона', reason: { name: 'Ожидание' } }],
      },
    ]);
    // Проекция ReportAnalytics по этому отчёту отсутствует (лаг проекции).
    analyticsFindMany.mockResolvedValue([]);

    const snap = await getFleetSnapshot({ tenantId: 'orion' });
    const card = snap.equipment[0];

    expect(card.status).toBe('active');
    expect(card.todayTotals).toEqual({
      piles: 4, pileMeters: 48, drillingCount: 3, drillingMeters: 21, downtimeHours: 1.5,
    });
    expect(card.downtimeReason).toBe('Ожидание: ожидание бетона');
    expect(snap.totals.pilesToday).toBe(4);
    expect(snap.totals.pileMetersToday).toBe(48);
  });

  it('не выдумывает длину сваи и причину простоя, когда их нет в данных', async () => {
    const today = ymd(new Date());
    equipmentFindMany.mockResolvedValue([equipment('eq-1')]);
    reportFindMany.mockResolvedValue([
      {
        ...report('r1', 'eq-1', today),
        // Длина не задана в справочнике (lengthMm null) — 0 м, без разбора имени.
        piles: [{ count: 5, pileGrade: { name: 'С300', lengthMm: null } }],
        // Строка без count трактуется как одна скважина; метры не заданы.
        drillings: [{ count: null, meters: null }],
        // Причина простоя не привязана к справочнику.
        downtimes: [{ duration: 2, comment: null, reason: null }],
      },
    ]);

    const snap = await getFleetSnapshot({ tenantId: 'orion' });
    const card = snap.equipment[0];

    expect(card.todayTotals).toEqual({
      piles: 5, pileMeters: 0, drillingCount: 1, drillingMeters: 0, downtimeHours: 2,
    });
    expect(card.downtimeReason).toBe('Причина не указана');
  });
});