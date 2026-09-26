/**
 * Regression: exportReportsCsv built its `where` clause from siteId/date
 * filters only — no tenantId — so any ADMIN (reports.export is ADMIN-only)
 * could download every tenant's report rows via GET /api/reports/export.
 * Same bug class as the IS-NULL-OR-tenantId IDOR (CLAUDE.md); fix is fail
 * closed + strict tenantId equality, mirroring getSiteAnalytics.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Sheet = { name: string; rows: (string | number | null)[][] };

const { findMany, sheets } = vi.hoisted(() => ({
  findMany: vi.fn(),
  sheets: { current: [] as Sheet[] },
}));

vi.mock('@/lib/db', () => ({ db: { report: { findMany } } }));
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
  });

  it('печатает «Статус» в детализации: черновик и сданный', async () => {
    findMany.mockResolvedValue([report('R-1', 'draft'), report('R-2', 'submitted')]);

    await exportReportsXlsx({ tenantId: 'tenant-a' });

    const detail = sheet('Детализация');
    expect(detail.rows[0]).toContain('Статус');
    expect(detail.rows[1][3]).toBe('черновик (смена не сдана)');
    expect(detail.rows[2][3]).toBe('сдан');
  });

  it('подписывает итоги периода, в который попали несданные смены', async () => {
    findMany.mockResolvedValue([report('R-1', 'draft'), report('R-2', 'submitted')]);

    await exportReportsXlsx({ tenantId: 'tenant-a' });

    expect(sheet('Итоги').rows).toContainEqual(['Включены несданные смены: 1']);
  });

  it('без черновиков подписи нет', async () => {
    findMany.mockResolvedValue([report('R-2', 'submitted')]);

    await exportReportsXlsx({ tenantId: 'tenant-a' });

    expect(sheet('Итоги').rows.some((row) => String(row[0]).startsWith('Включены'))).toBe(false);
  });
});
