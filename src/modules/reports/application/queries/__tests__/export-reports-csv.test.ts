/**
 * exportReportsCsv — tenant scoping regression.
 *
 * Pre-existing IDOR: the where-clause built no tenantId filter at all, so
 * any authenticated user with `reports.export` could pull every tenant's
 * report data via /api/reports/export. Fail-closed fix mirrors the rest of
 * the codebase's tenant-scoping convention.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findManyMock } = vi.hoisted(() => ({ findManyMock: vi.fn() }));

vi.mock('@/lib/db', () => ({ db: { report: { findMany: findManyMock } } }));

import { exportReportsCsv } from '../report-query.service';

describe('exportReportsCsv — tenant scoping', () => {
  beforeEach(() => {
    findManyMock.mockReset();
    findManyMock.mockResolvedValue([]);
  });

  it('rejects when tenantId is missing (fail-closed IDOR guard)', async () => {
    await expect(exportReportsCsv({ tenantId: '' })).rejects.toThrow('tenantId is required');
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it('scopes the query to the caller tenantId', async () => {
    await exportReportsCsv({ tenantId: 'tenant-a' });

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-a' }) })
    );
  });
});

/**
 * Подстановка формул. Комментарий к простою пишет оператор в свободной форме,
 * а выгрузку открывает администратор в Excel — значит содержимое ячейки не
 * должно становиться исполняемым.
 */
describe('exportReportsCsv — защита от формул', () => {
  const reportWith = (comment: string, duration = 2) => ({
    reportId: 'R-1', date: '2026-08-17', shiftType: 'DAY',
    site: { name: 'Объект' }, user: { name: 'Иванов' },
    crew: { name: 'Экипаж', equipment: { name: 'Banut 655' } },
    piles: [], drillings: [],
    downtimes: [{ duration, comment, reason: { name: 'Ремонт' } }],
  });

  beforeEach(() => { findManyMock.mockReset(); });

  it.each([
    ['=HYPERLINK("http://evil","click")', 'формула через ='],
    ['+1+1', 'формула через +'],
    ['@SUM(A1:A9)', 'формула через @'],
    ['-2+3', 'выражение через -'],
    ['\t=1+1', 'формула за табуляцией'],
  ])('обезвреживает %s (%s)', async (comment) => {
    findManyMock.mockResolvedValue([reportWith(comment)]);

    const csv = await exportReportsCsv({ tenantId: 'tenant-a' });

    // Апостроф перед содержимым: Excel показывает текст и не вычисляет его.
    // Кавычки внутри значения при этом удваиваются по обычным правилам CSV.
    expect(csv).toContain(`"'${comment.replace(/"/g, '""')}"`);
  });

  it('не портит обычные числа — иначе колонка перестанет суммироваться', async () => {
    findManyMock.mockResolvedValue([reportWith('Плановый простой', -2)]);

    const csv = await exportReportsCsv({ tenantId: 'tenant-a' });

    expect(csv).toContain('"-2"');
    expect(csv).not.toContain(`"'-2"`);
  });

  it('не трогает обычный текст', async () => {
    findManyMock.mockResolvedValue([reportWith('Замена троса')]);

    const csv = await exportReportsCsv({ tenantId: 'tenant-a' });

    expect(csv).toContain('"Замена троса"');
    expect(csv).not.toContain(`"'Замена троса"`);
  });
});
