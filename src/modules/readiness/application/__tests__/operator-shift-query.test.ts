/**
 * Сутки смены — по поясу организации, а не по поясу процесса.
 *
 * Сервер живёт в UTC (в `Dockerfile` нет `TZ`), а машины разработчиков — в МСК,
 * поэтому пояс процесса здесь задаётся явно: иначе проверка повторила бы пояс
 * тенанта случайно. На UTC-сервере «локальная полночь» процесса наступает в
 * 03:00 МСК: показание счётчика, снятое в 01:30 МСК, в такое окно не попадало,
 * оператор считался не внесшим показания, и шаг закрытия смены блокировался
 * (F-R37-2). Ниже окно проверяется по моменту, который служба реально отдала
 * в запрос `MeterReading.count`, а не по возвращённому ей числу.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  crewFindMany: vi.fn(),
  shiftFindFirst: vi.fn(),
  tenantSettingsFindUnique: vi.fn(),
  currentReadinessFindFirst: vi.fn(),
  meterReadingCount: vi.fn(),
  meterReadingFindFirst: vi.fn(),
  shiftHandoverFindFirst: vi.fn(),
  userFindFirst: vi.fn(),
  readinessScoreSnapshotFindFirst: vi.fn(),
  getOperatorClearance: vi.fn(),
  hasPostShiftSection: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    crew: { findMany: mocks.crewFindMany },
    shift: { findFirst: mocks.shiftFindFirst },
    tenantSettings: { findUnique: mocks.tenantSettingsFindUnique },
    currentReadiness: { findFirst: mocks.currentReadinessFindFirst },
    meterReading: { count: mocks.meterReadingCount, findFirst: mocks.meterReadingFindFirst },
    shiftHandover: { findFirst: mocks.shiftHandoverFindFirst },
    user: { findFirst: mocks.userFindFirst },
    readinessScoreSnapshot: { findFirst: mocks.readinessScoreSnapshotFindFirst },
  },
}));

vi.mock('@/modules/users', () => ({ getOperatorClearance: mocks.getOperatorClearance }));
vi.mock('@/modules/inspections', () => ({ hasPostShiftSection: mocks.hasPostShiftSection }));

import { getOperatorShiftFacts } from '../operator-shift-query';

const EQUIPMENT = { id: 'eq-1', name: 'Установка', model: 'М1', engineHoursTotal: 100, nextMaintenanceAtHours: 200 };

/** Смены нет — проверяем только окно показаний, оно считается в обеих ветках. */
function arrange(timezone: string | null) {
  mocks.getOperatorClearance.mockResolvedValue({ blockers: [], warnings: [], documents: [] });
  mocks.hasPostShiftSection.mockResolvedValue(false);
  mocks.crewFindMany.mockResolvedValue([
    { equipment: EQUIPMENT, site: { id: 'site-1', name: 'Площадка' } },
  ]);
  mocks.shiftFindFirst.mockResolvedValue(null);
  mocks.tenantSettingsFindUnique.mockResolvedValue(timezone === null ? null : { timezone });
  mocks.currentReadinessFindFirst.mockResolvedValue(null);
  mocks.meterReadingFindFirst.mockResolvedValue(null);
  mocks.shiftHandoverFindFirst.mockResolvedValue(null);
  mocks.userFindFirst.mockResolvedValue(null);
  mocks.readinessScoreSnapshotFindFirst.mockResolvedValue(null);
}

/** Считает показания так же, как это сделает база: по переданной границе окна. */
function countReadingsAboveBoundary(readings: Date[]) {
  mocks.meterReadingCount.mockImplementation((args: { where: { recordedAt: { gte: Date } } }) =>
    Promise.resolve(readings.filter((at) => at >= args.where.recordedAt.gte).length),
  );
}

const windowStart = () => mocks.meterReadingCount.mock.calls[0][0].where.recordedAt.gte as Date;

describe('operator shift facts — окно «показания за сегодня»', () => {
  const processTimezone = process.env.TZ;

  beforeEach(() => {
    vi.clearAllMocks();
    // Сервер в UTC, а не в поясе разработчика.
    process.env.TZ = 'UTC';
  });

  afterEach(() => {
    if (processTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = processTimezone;
  });

  it('начинается в местную полночь, а не в UTC-полночь процесса', async () => {
    arrange('Europe/Moscow');

    // Сейчас 26.09, 10:00 МСК.
    await getOperatorShiftFacts('orion', 'op-1', new Date('2026-09-26T07:00:00Z'));

    expect(windowStart().toISOString()).toBe('2026-09-25T21:00:00.000Z');
  });

  it('считает показание, снятое в 01:30 МСК, внесённым за сегодня', async () => {
    arrange('Europe/Moscow');
    countReadingsAboveBoundary([new Date('2026-09-25T22:30:00Z')]);

    const facts = await getOperatorShiftFacts('orion', 'op-1', new Date('2026-09-26T07:00:00Z'));

    expect(facts.meterKnownToday).toBe(true);
  });

  it('не считает вчерашним показание, снятое в 23:59 МСК накануне', async () => {
    arrange('Europe/Moscow');
    countReadingsAboveBoundary([new Date('2026-09-25T20:59:00Z')]);

    const facts = await getOperatorShiftFacts('orion', 'op-1', new Date('2026-09-26T07:00:00Z'));

    expect(facts.meterKnownToday).toBe(false);
  });

  it('в 01:00 МСК не подставляет предыдущие UTC-сутки', async () => {
    arrange('Europe/Moscow');
    // Показание вчера, 25.09 в 10:00 МСК: при окне от UTC-полуночи 25.09 оно
    // попадало в «сегодня» (обратная сторона той же ошибки).
    countReadingsAboveBoundary([new Date('2026-09-25T07:00:00Z')]);

    // Сейчас 26.09, 01:00 МСК.
    const facts = await getOperatorShiftFacts('orion', 'op-1', new Date('2026-09-25T22:00:00Z'));

    expect(windowStart().toISOString()).toBe('2026-09-25T21:00:00.000Z');
    expect(facts.meterKnownToday).toBe(false);
  });

  it('берёт пояс организации, а не МСК по умолчанию', async () => {
    arrange('Asia/Vladivostok');

    await getOperatorShiftFacts('orion', 'op-1', new Date('2026-09-25T22:30:00Z'));

    // 26.09, 08:30 во Владивостоке (UTC+10) — местная полночь 14:00Z накануне.
    expect(windowStart().toISOString()).toBe('2026-09-25T14:00:00.000Z');
  });

  it('без настроек и при сломанном поясе откатывается на пояс организации по умолчанию', async () => {
    for (const timezone of [null, '(UTC+3) Moscow']) {
      vi.clearAllMocks();
      arrange(timezone);

      await getOperatorShiftFacts('orion', 'op-1', new Date('2026-09-26T07:00:00Z'));

      expect(windowStart().toISOString()).toBe('2026-09-25T21:00:00.000Z');
    }
  });
});
