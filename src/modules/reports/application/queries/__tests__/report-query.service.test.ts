/**
 * Regression: exportReportsCsv built its `where` clause from siteId/date
 * filters only — no tenantId — so any ADMIN (reports.export is ADMIN-only)
 * could download every tenant's report rows via GET /api/reports/export.
 * Same bug class as the IS-NULL-OR-tenantId IDOR (CLAUDE.md); fix is fail
 * closed + strict tenantId equality, mirroring getSiteAnalytics.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Sheet = { name: string; rows: (string | number | null)[][] };

const { findMany, reportCount, mediaFindMany, pileWorkGroupBy, leaderDrillingAggregate, downtimeAggregate, sheets, getSettings } = vi.hoisted(() => ({
  findMany: vi.fn(),
  reportCount: vi.fn(),
  mediaFindMany: vi.fn(),
  pileWorkGroupBy: vi.fn(),
  leaderDrillingAggregate: vi.fn(),
  downtimeAggregate: vi.fn(),
  sheets: { current: [] as Sheet[] },
  getSettings: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    report: { findMany, count: reportCount },
    media: { findMany: mediaFindMany },
    pileWork: { groupBy: pileWorkGroupBy },
    leaderDrilling: { aggregate: leaderDrillingAggregate },
    reportDowntime: { aggregate: downtimeAggregate },
  },
}));
vi.mock('@/modules/settings', () => ({ getSettings }));
// Листы перехватываем до упаковки в ZIP: «Статус» и подпись итогов — текст
// листа, а не бинарник.
vi.mock('@/lib/xlsx-writer', () => ({
  buildXlsx: (built: Sheet[]) => {
    sheets.current = built;
    return Buffer.from('');
  },
}));

import { exportReportsCsv, exportReportsXlsx, listReportsForReview, listReportsForUserScope, getEditableReport, getReportsByPeriod } from '../report-query.service';

describe('exportReportsCsv — tenant isolation', () => {
  beforeEach(() => {
    findMany.mockReset();
    findMany.mockResolvedValue([]);
  });

  it('throws when tenantId is missing (fail closed)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test: exercising the missing-tenantId guard
    await expect(exportReportsCsv({} as any)).rejects.toThrow('tenantId');
    expect(findMany).not.toHaveBeenCalled();
  });

  it('scopes the query to the caller tenant with strict equality', async () => {
    await exportReportsCsv({ tenantId: 'orion', siteId: 's1', dateFrom: '2026-01-01', dateTo: '2026-01-31' });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'orion', siteId: 's1' }),
      })
    );
  });
});

// R26-2: для не-платформенной роли без организации фильтр молча не ставился —
// то есть «все отчёты всех организаций». ADMIN/DISPATCHER видят все организации
// по решению владельца (AGENTS.md) и под правило не попадают.
describe('listReportsForReview — tenant isolation', () => {
  it('refuses an operator without a tenant instead of listing every tenant', async () => {
    findMany.mockReset();
    await expect(listReportsForReview({ id: 'u1', role: 'OPERATOR', tenantId: null })).rejects.toThrow(/организац/);
    expect(findMany).not.toHaveBeenCalled();
  });
});

// V1 (AUDIT-INDEP-HERMES): у listReportsForUserScope фильтр организации ставился
// только при непустом tenantId — при пустом выборка `{ userId }` уходила без
// организации (fail-open), расходясь с правилом «нет tenantId — отказ» и с
// соседней listReportsForReview выше. Платформенные роли (ADMIN/DISPATCHER)
// видят все организации по решению владельца и под правило не попадают.
describe('listReportsForUserScope — tenant isolation (V1)', () => {
  beforeEach(() => {
    findMany.mockReset();
    findMany.mockResolvedValue([]);
  });

  it('refuses an operator without a tenant instead of listing every tenant', async () => {
    await expect(
      listReportsForUserScope({ id: 'u1', role: 'OPERATOR', tenantId: null }),
    ).rejects.toThrow(/организац/);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('scopes the query to the caller tenant with strict equality', async () => {
    await listReportsForUserScope({ id: 'u1', role: 'OPERATOR', tenantId: 'orion' });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'u1', tenantId: 'orion' }),
      }),
    );
  });

  it('lets a platform admin through without a tenant filter', async () => {
    await listReportsForUserScope({ id: 'a1', role: 'ADMIN', tenantId: null });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'a1' } }));
  });
});

/**
 * Статус смены в Excel (F-O6, решение владельца 26.09.2026). Лист «Детализация»
 * помечает черновик, лист «Итоги» подписывает период, в который такие смены
 * попали: по файлу должно быть видно, почему его сумма больше аналитики
 * (черновики в KPI не считаются). Состав строк не меняется.
 */
describe('exportReportsXlsx — статус смены', () => {
  const report = (reportId: string, status: string) => ({
    reportId, date: '2026-09-26', shiftType: 'DAY', status,
    site: { name: 'Объект' }, user: { name: 'Иванов' },
    crew: null, equipment: { name: 'Banut 655' },
    piles: [{ count: 2, pileGrade: { name: 'С300', lengthMm: 12000 } }],
    drillings: [], downtimes: [],
  });

  const sheet = (name: string): Sheet => {
    const found = sheets.current.find((item) => item.name === name);
    if (!found) throw new Error(`листа «${name}» нет в выгрузке`);
    return found;
  };

  beforeEach(() => {
    sheets.current = [];
    findMany.mockReset();
    getSettings.mockReset();
    getSettings.mockResolvedValue({ timezone: 'Europe/Moscow', companyName: 'ООО «ОРИОН-Строй»', inn: '7701234567' });
  });

  it('печатает «Статус» в детализации: черновик и сданный', async () => {
    findMany.mockResolvedValue([report('R-1', 'draft'), report('R-2', 'submitted')]);

    await exportReportsXlsx({ tenantId: 'tenant-a' });

    const detail = sheet('Детализация');
    const header = detail.rows.findIndex((row) => row[0] === 'ID отчёта');
    expect(detail.rows[header]).toContain('Статус');
    expect(detail.rows[header + 1][3]).toBe('черновик (смена не сдана)');
    expect(detail.rows[header + 2][3]).toBe('сдан');
  });

  /**
   * Реквизиты выгрузки (F-R44-9). Файл уходит в переписку или подшивается —
   * без организации, периода и отметки «выгружено» проверить его вне интерфейса
   * нечем. Отметка «Выгружено» — по поясу организации, как в журнале забивки.
   */
  it('печатает реквизиты над таблицей детализации', async () => {
    findMany.mockResolvedValue([]);

    await exportReportsXlsx({ tenantId: 'tenant-a', dateFrom: '2026-09-01', dateTo: '2026-09-30' });

    const rows = sheet('Детализация').rows;
    expect(rows[0]).toEqual(['Организация: ООО «ОРИОН-Строй», ИНН 7701234567']);
    expect(rows[1][0]).toBe('Период: 01.09.2026 — 30.09.2026');
    expect(String(rows[2][0])).toMatch(/^Выгружено: \d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/);
    // Пустая строка отделяет реквизиты от шапки таблицы.
    expect(rows[3]).toEqual([]);
    expect(rows[4][0]).toBe('ID отчёта');
  });

  it('без названия организации и ИНН строку организации не печатает', async () => {
    getSettings.mockResolvedValue({ timezone: 'Europe/Moscow', companyName: '', inn: '' });
    findMany.mockResolvedValue([]);

    await exportReportsXlsx({ tenantId: 'tenant-a' });

    const rows = sheet('Детализация').rows;
    expect(rows[0][0]).toBe('Период: — — —');
    expect(rows.some((row) => String(row[0]).startsWith('Организация'))).toBe(false);
  });

  it('отделяет несданные смены от итогов периода', async () => {
    findMany.mockResolvedValue([report('R-1', 'draft'), report('R-2', 'submitted')]);

    await exportReportsXlsx({ tenantId: 'tenant-a' });

    expect(sheet('Итоги').rows.map(row => row[0])).toEqual(['ID отчёта', 'R-2']);
    expect(sheet('Черновики').rows.map(row => row[0])).toEqual(['ID отчёта', 'R-1']);
    expect(sheet('Черновики').rows[1]).toContain('черновик (смена не сдана)');
  });

  it('без черновиков подписи нет', async () => {
    findMany.mockResolvedValue([report('R-2', 'submitted')]);

    await exportReportsXlsx({ tenantId: 'tenant-a' });

    expect(sheet('Итоги').rows.some((row) => String(row[0]).startsWith('Включены'))).toBe(false);
  });
});

/**
 * F-R140-PAGING: у отчётов с одинаковой датой порядок внутри даты был
 * недетерминирован (`orderBy: { date: 'desc' }`), а курсор листает по id
 * (`src/lib/pagination.ts:44-53`) — «Загрузить ещё» могло повторить или
 * пропустить строку. Живой базы в тестовом окружении нет, поэтому Prisma
 * моделируется: сортировка по фактически переданному orderBy, затем позиция
 * курсора + skip, затем take — ровно как у курсора Prisma. Ничьи на одной
 * дате БД отдаёт в произвольном порядке, поэтому модель переставляет их от
 * вызова к вызову (сдвиг по номеру вызова); без этого старая сортировка без
 * тай-брейкера выглядела бы стабильной и дефект не воспроизвёлся бы.
 */
describe('listReportsForReview — устойчивые страницы (F-R140-PAGING)', () => {
  // Семь отчётов, из них пять — за одну дату (страница по два: >1 страницы).
  const rows = [
    { id: 'id-f', date: '2026-09-26', reportId: 'R-f', journalPhotoMediaId: null },
    { id: 'id-b', date: '2026-09-26', reportId: 'R-b', journalPhotoMediaId: null },
    { id: 'id-d', date: '2026-09-26', reportId: 'R-d', journalPhotoMediaId: null },
    { id: 'id-a', date: '2026-09-26', reportId: 'R-a', journalPhotoMediaId: null },
    { id: 'id-c', date: '2026-09-26', reportId: 'R-c', journalPhotoMediaId: null },
    { id: 'id-g', date: '2026-09-20', reportId: 'R-g', journalPhotoMediaId: null },
    { id: 'id-e', date: '2026-09-10', reportId: 'R-e', journalPhotoMediaId: null },
  ];

  const hash = (value: string) => [...value].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);

  // Эмулятор курсора Prisma: применяет orderBy (единственное, что зависит от
  // правки), затем отбрасывает строки до курсора и берёт take.
  function fakeFindMany(source: typeof rows) {
    let call = 0;
    return (args: {
      orderBy?: Record<string, 'asc' | 'desc'> | Array<Record<string, 'asc' | 'desc'>>;
      take?: number;
      cursor?: { id: string };
      skip?: number;
    }) => {
      const myCall = call++;
      const orderBy = Array.isArray(args.orderBy) ? args.orderBy : [args.orderBy ?? {}];
      const sorted = [...source].sort((a, b) => {
        for (const clause of orderBy) {
          for (const [field, dir] of Object.entries(clause)) {
            const av = String((a as Record<string, unknown>)[field]);
            const bv = String((b as Record<string, unknown>)[field]);
            if (av !== bv) return (dir === 'desc' ? -1 : 1) * av.localeCompare(bv);
          }
        }
        return ((hash(a.id) + myCall) % 7) - ((hash(b.id) + myCall) % 7);
      });
      const start = args.cursor
        ? sorted.findIndex((r) => r.id === args.cursor?.id) + (args.skip ?? 0)
        : 0;
      return Promise.resolve(sorted.slice(start, start + (args.take ?? sorted.length)));
    };
  }

  beforeEach(() => {
    findMany.mockReset();
    reportCount.mockReset();
    mediaFindMany.mockReset();
    pileWorkGroupBy.mockReset();
    leaderDrillingAggregate.mockReset();
    downtimeAggregate.mockReset();
    reportCount.mockResolvedValue(0);
    mediaFindMany.mockResolvedValue([]);
    pileWorkGroupBy.mockResolvedValue([]);
    leaderDrillingAggregate.mockResolvedValue({ _sum: { count: 0, meters: 0 } });
    downtimeAggregate.mockResolvedValue({ _sum: { duration: 0 } });
  });

  it('листает весь набор без дублей и пропусков, ставя уникальный тай-брейкер id', async () => {
    const spy = fakeFindMany(rows);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped external/library boundary: fake Prisma findMany
    findMany.mockImplementation((args: any) => spy(args));

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const result = await listReportsForReview(
        { id: 'u1', role: 'ADMIN' },
        null,
        { cursor, limit: 2 },
        null,
      );
      seen.push(...result.data.map((r) => (r as { id: string }).id));
      if (!result.hasMore) break;
      cursor = result.nextCursor ?? undefined;
    }

    // Все id ровно один раз — при ничьей на одной дате старая сортировка
    // (только по date) давала повторы/пропуски на стыке страниц.
    expect(seen).toHaveLength(rows.length);
    expect(new Set(seen).size).toBe(rows.length);
    expect([...seen].sort()).toEqual(rows.map((r) => r.id).sort());

    // Тай-брейкер id обязателен: без него порядок ничьих не полон.
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ date: 'desc' }, { id: 'desc' }] }),
    );
  });
});

// AU70: отказы при нехватке параметров показывались по-английски и с именами
// полей (siteId, dateFrom). Тексты переведены, поведение (400 и порядок
// проверок до обращения к базе) не менялось.
describe('русские тексты отказов при нехватке параметров (AU70)', () => {
  it('getEditableReport без объекта и даты говорит, что выбрать', async () => {
    await expect(
      getEditableReport({ id: 'u1', role: 'OPERATOR' }, null, null, null),
    ).rejects.toThrow('Выберите объект и дату.');
  });

  it('getReportsByPeriod без начала и конца периода просит указать период', async () => {
    await expect(getReportsByPeriod(null, null)).rejects.toThrow('Укажите начало и конец периода.');
  });
});
