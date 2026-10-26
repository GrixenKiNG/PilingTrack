import {beforeEach, describe, expect, it, vi} from 'vitest';

/*
  Чтение отчётов: журнал диспетчера, итоги, фото, лента дашборда.

  Что здесь держится:
  - итоги журнала считаются по сданным отчётам и по длине из марки сваи, а не по
    загруженной странице;
  - признак «есть фото» берётся из таблицы файлов по бизнес-id отчёта (reportId),
    а не по первичному ключу — иначе строка не находится;
  - лента дашборда и чтение «моего отчёта» не пускают пользователя без организации.
*/
const h = vi.hoisted(() => ({
  reportFindMany: vi.fn(),
  reportFindFirst: vi.fn(),
  reportCount: vi.fn(),
  mediaFindMany: vi.fn(),
  mediaGroupBy: vi.fn(),
  pileWorkGroupBy: vi.fn(),
  pileGradeFindMany: vi.fn(),
  drillingAggregate: vi.fn(),
  downtimeAggregate: vi.fn(),
  summaryFindUnique: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    report: {findMany: h.reportFindMany, findFirst: h.reportFindFirst, count: h.reportCount},
    media: {findMany: h.mediaFindMany, groupBy: h.mediaGroupBy},
    pileWork: {groupBy: h.pileWorkGroupBy},
    pileGrade: {findMany: h.pileGradeFindMany},
    leaderDrilling: {aggregate: h.drillingAggregate},
    reportDowntime: {aggregate: h.downtimeAggregate},
    siteDailySummary: {findUnique: h.summaryFindUnique},
  },
}));

import {
  getDashboardStats, getEditableReport, listRecentReportsForDashboard, listReportsForReview,
} from '../report-query.service';

const OPERATOR = {id: 'op-1', role: 'OPERATOR', tenantId: 'tenant-a'};

beforeEach(() => {
  vi.clearAllMocks();
  h.reportCount.mockResolvedValue(0);
  h.reportFindMany.mockResolvedValue([]);
  h.mediaFindMany.mockResolvedValue([]);
  h.pileWorkGroupBy.mockResolvedValue([]);
  h.pileGradeFindMany.mockResolvedValue([]);
  h.drillingAggregate.mockResolvedValue({_sum: {count: 0, meters: 0}});
  h.downtimeAggregate.mockResolvedValue({_sum: {duration: 0}});
});

describe('итоги журнала диспетчера', () => {
  it('считаются по сданным отчётам и по длине сваи из марки, а не по странице', async () => {
    h.reportCount.mockResolvedValue(3);
    h.pileWorkGroupBy.mockResolvedValue([
      {pileGradeId: 'g12', _sum: {count: 10}},
      {pileGradeId: 'g-unknown', _sum: {count: 5}},
    ]);
    h.pileGradeFindMany.mockResolvedValue([{id: 'g12', lengthMm: 12_000}]);
    h.drillingAggregate.mockResolvedValue({_sum: {count: 4, meters: 40}});
    h.downtimeAggregate.mockResolvedValue({_sum: {duration: 2.5}});

    const result = await listReportsForReview({id: 'a', role: 'ADMIN'});

    expect(result.sums).toEqual({
      reports: 3,
      piles: 15,
      // 10 свай по 12 м; марка без длины даёт 0 м, а не угаданное по названию.
      pileMeters: 120,
      drillingCount: 4,
      drillingMeters: 40,
      downtimeHours: 2.5,
    });
    // Черновик в итоги не входит ни одним запросом.
    for (const call of [h.reportCount.mock.calls[1], h.pileWorkGroupBy.mock.calls[0], h.drillingAggregate.mock.calls[0]]) {
      expect(JSON.stringify(call[0].where)).toContain('submitted');
    }
  });

  it('пустой отбор даёт нули и не ходит за марками', async () => {
    const result = await listReportsForReview({id: 'a', role: 'ADMIN'});

    expect(result.sums).toEqual({
      reports: 0, piles: 0, pileMeters: 0, drillingCount: 0, drillingMeters: 0, downtimeHours: 0,
    });
    expect(h.pileGradeFindMany).not.toHaveBeenCalled();
  });

  it('фильтры объекта и работника попадают и в страницу, и в итоги', async () => {
    await listReportsForReview({id: 'a', role: 'ADMIN'}, 'site-1', undefined, 'user-9');

    expect(h.reportCount.mock.calls[0][0].where).toEqual({siteId: 'site-1', userId: 'user-9'});
    expect(h.reportFindMany.mock.calls[0][0].where).toEqual({siteId: 'site-1', userId: 'user-9'});
  });

  it('признак фото берётся по reportId из таблицы файлов, иначе — по фото журнала', async () => {
    h.reportFindMany.mockResolvedValue([
      {id: 'id-1', reportId: 'R-1', journalPhotoMediaId: null},
      {id: 'id-2', reportId: 'R-2', journalPhotoMediaId: 'journal-photo'},
      {id: 'id-3', reportId: 'R-3', journalPhotoMediaId: null},
    ]);
    h.mediaFindMany.mockResolvedValue([
      {id: 'm-first', entityId: 'R-1'},
      {id: 'm-second', entityId: 'R-1'},
    ]);

    const result = await listReportsForReview({id: 'a', role: 'ADMIN'});

    expect(result.data.map((row) => [row.reportId, row.hasPhotos, row.thumbnailMediaId])).toEqual([
      ['R-1', true, 'm-first'],
      ['R-2', true, 'journal-photo'],
      ['R-3', false, null],
    ]);
    expect(h.mediaFindMany.mock.calls[0][0].where.entityId).toEqual({in: ['R-1', 'R-2', 'R-3']});
  });
});

describe('лента отчётов на дашборде', () => {
  it('без организации — отказ, чужая не подставляется', async () => {
    await expect(listRecentReportsForDashboard({tenantId: null})).rejects.toMatchObject({status: 400});
    expect(h.reportFindMany).not.toHaveBeenCalled();
  });

  it('берёт только свою организацию и последние по обновлению', async () => {
    await listRecentReportsForDashboard({tenantId: 'tenant-a'}, 5);

    expect(h.reportFindMany.mock.calls[0][0]).toMatchObject({
      where: {tenantId: 'tenant-a'}, orderBy: {updatedAt: 'desc'}, take: 5,
    });
    expect(h.mediaGroupBy).not.toHaveBeenCalled();
  });

  it('собирает строку: фото по reportId, правка по версии, прочерки вместо пустых связей', async () => {
    h.reportFindMany.mockResolvedValue([
      {
        id: 'id-1', reportId: 'R-1', date: '2026-10-26', shiftType: 'DAY', status: 'submitted', version: 3,
        journalPhotoMediaId: null, updatedAt: new Date('2026-10-26T10:00:00Z'),
        site: {name: 'Объект 1'}, equipment: {name: 'LRH 100'}, user: {name: 'Иван'}, crew: {name: 'Бригада 1'},
      },
      {
        id: 'id-2', reportId: 'R-2', date: '2026-10-26', shiftType: 'NIGHT', status: 'draft', version: 1,
        journalPhotoMediaId: 'jp', updatedAt: new Date('2026-10-26T09:00:00Z'),
        site: null, equipment: null, user: null, crew: null,
      },
    ]);
    h.mediaGroupBy.mockResolvedValue([{entityId: 'R-1', _count: 2}]);

    const rows = await listRecentReportsForDashboard({tenantId: 'tenant-a'});

    expect(rows[0]).toMatchObject({
      siteName: 'Объект 1', equipmentName: 'LRH 100', operatorName: 'Иван', crewName: 'Бригада 1',
      hasPhoto: true, photoCount: 2, edited: true, updatedAt: '2026-10-26T10:00:00.000Z',
    });
    expect(rows[1]).toMatchObject({
      siteName: '—', equipmentName: '—', operatorName: '—', crewName: null,
      hasPhoto: true, photoCount: 1, edited: false,
    });
    expect(h.mediaGroupBy.mock.calls[0][0].where.entityId).toEqual({in: ['R-1', 'R-2']});
  });
});

describe('чтение «моего отчёта»', () => {
  it('оператор читает только в своей организации', async () => {
    await getEditableReport(OPERATOR, null, 'site-1', '2026-10-26');

    expect(h.reportFindFirst.mock.calls[0][0].where).toEqual({
      userId: 'op-1', siteId: 'site-1', date: '2026-10-26', tenantId: 'tenant-a',
    });
  });

  it('оператор без организации получает отказ, а не отчёты без фильтра', async () => {
    await expect(getEditableReport({id: 'op-1', role: 'OPERATOR', tenantId: null}, null, 'site-1', '2026-10-26'))
      .rejects.toMatchObject({status: 403});
    expect(h.reportFindFirst).not.toHaveBeenCalled();
  });

  it('оператор не подменяет работника чужим id', async () => {
    await expect(getEditableReport(OPERATOR, 'someone-else', 'site-1', '2026-10-26'))
      .rejects.toMatchObject({status: 403});
    expect(h.reportFindFirst).not.toHaveBeenCalled();
  });
});

describe('сводка дня по объекту', () => {
  it('нет проекции за день — нули, а не ошибка', async () => {
    h.summaryFindUnique.mockResolvedValue(null);

    expect(await getDashboardStats('site-1', '2026-10-26')).toEqual({
      siteId: 'site-1', date: '2026-10-26', totalPiles: 0, totalDrilling: 0, totalDowntime: 0, reportCount: 0,
    });
  });

  it('есть проекция — отдаётся как есть', async () => {
    const summary = {siteId: 'site-1', date: '2026-10-26', totalPiles: 7, totalDrilling: 1, totalDowntime: 0.5, reportCount: 2};
    h.summaryFindUnique.mockResolvedValue(summary);

    expect(await getDashboardStats('site-1', '2026-10-26')).toBe(summary);
    expect(h.summaryFindUnique).toHaveBeenCalledWith({where: {siteId_date: {siteId: 'site-1', date: '2026-10-26'}}});
  });
});
