/**
 * Regression: exportReportsCsv built its `where` clause from siteId/date
 * filters only — no tenantId — so any ADMIN (reports.export is ADMIN-only)
 * could download every tenant's report rows via GET /api/reports/export.
 * Same bug class as the IS-NULL-OR-tenantId IDOR (CLAUDE.md); fix is fail
 * closed + strict tenantId equality, mirroring getSiteAnalytics.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Sheet = { name: string; rows: (string | number | null)[][] };

const { findMany, sheets, getSettings } = vi.hoisted(() => ({
  findMany: vi.fn(),
  sheets: { current: [] as Sheet[] },
  getSettings: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ db: { report: { findMany } } }));
vi.mock('@/modules/settings', () => ({ getSettings }));
// Листы перехватываем до упаковки в ZIP: «Статус» и подпись итогов — текст
// листа, а не бинарник.
vi.mock('@/lib/xlsx-writer', () => ({
  buildXlsx: (built: Sheet[]) => {
    sheets.current = built;
    return Buffer.from('');
  },
}));

import { exportReportsCsv, exportReportsXlsx, listReportsForReview } from '../report-query.service';

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
