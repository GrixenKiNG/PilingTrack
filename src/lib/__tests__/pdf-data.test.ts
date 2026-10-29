// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ report: vi.fn(), crew: vi.fn(), crews: vi.fn(), equipment: vi.fn(), reports: vi.fn(), settings: vi.fn(), warn: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { report: { findUnique: m.report }, crew: { findFirst: m.crew, findMany: m.crews }, equipment: { findFirst: m.equipment } } }));
vi.mock('@/modules/settings', () => ({ getSettings: m.settings }));
vi.mock('@/modules/reports/application/queries/report-query.service', () => ({ getReportsByPeriod: m.reports }));
vi.mock('@/lib/logger', () => ({ logger: { warn: m.warn } }));
import { buildPeriodPdfData, loadCompanyName, loadSingleReportPdfContext, type SingleReportPdfContext } from '../pdf-data';

const report = (overrides: Partial<SingleReportPdfContext['report']> = {}): SingleReportPdfContext['report'] => ({
  reportId: 'report-a', version: 3, userId: 'operator-a', siteId: 'site-a', tenantId: 'tenant-a', date: '2026-10-29',
  shiftStart: null, shiftEnd: null, shiftType: 'DAY', status: 'submitted', lastEditedByName: null, lastEditedByRole: null,
  equipment: null, user: null, site: null, crew: null, piles: [], drillings: [], downtimes: [], ...overrides,
});
const period = { dateFrom: '2026-10-01', dateTo: '2026-10-31', tenantId: 'tenant-a' };
beforeEach(() => {
  vi.resetAllMocks();
  m.report.mockResolvedValue(null); m.crew.mockResolvedValue(null); m.crews.mockResolvedValue([]);
  m.reports.mockResolvedValue([]); m.equipment.mockResolvedValue(null); m.settings.mockResolvedValue({ companyName: 'Учебная организация' });
});

describe('PDF data — absent and partial shifts', () => {
  it('returns null for an absent report without inventing a crew or company', async () => {
    await expect(loadSingleReportPdfContext('absent')).resolves.toBeNull();
    expect(m.crew).not.toHaveBeenCalled(); expect(m.settings).not.toHaveBeenCalled();
  });
  it('preserves empty production, missing clock fields, zero fuel and meter readings', async () => {
    const source = report({ endingEngineHours: 0, endingFuelPercent: 0 }); m.report.mockResolvedValue(source);
    const context = await loadSingleReportPdfContext(source.reportId);
    expect(context?.report).toBe(source);
    expect(context?.pdfData).toMatchObject({ reportId: source.reportId, version: 3, shiftStart: null, shiftEnd: null, endingEngineHours: 0, endingFuelPercent: 0, assistantName: '', equipmentName: '', piles: [], drillings: [], downtimes: [], companyName: 'Учебная организация' });
    expect(m.crew).toHaveBeenCalledWith(expect.objectContaining({ where: { operatorId: 'operator-a', siteId: 'site-a', isActive: true } }));
  });
  it('uses the report crew snapshot and prioritizes the report equipment over crew equipment', async () => {
    m.report.mockResolvedValue(report({ equipment: { name: 'Установка отчёта' }, crew: { assistants: [{ name: 'Анна' }, { name: 'Борис' }], equipment: { name: 'Текущая установка' } } }));
    const context = await loadSingleReportPdfContext('report-a');
    expect(context?.pdfData).toMatchObject({ assistantName: 'Анна, Борис', equipmentName: 'Установка отчёта' });
    expect(m.crew).not.toHaveBeenCalled();
  });
  it('fills a legacy missing crew without mutating the loaded report', async () => {
    const source = report(); m.report.mockResolvedValue(source);
    m.crew.mockResolvedValue({ assistants: [{ name: 'Помощник' }], equipment: { name: 'Установка бригады' } });
    const context = await loadSingleReportPdfContext('report-a');
    expect(context?.pdfData).toMatchObject({ assistantName: 'Помощник', equipmentName: 'Установка бригады' });
    expect(source.crew).toBeNull();
  });
  it('keeps PDF data available when company settings fail', async () => {
    m.report.mockResolvedValue(report()); m.settings.mockRejectedValue(new Error('settings unavailable'));
    const context = await loadSingleReportPdfContext('report-a');
    expect(context?.pdfData.companyName).toBeUndefined(); expect(context?.pdfData.reportId).toBe('report-a');
    expect(m.warn).toHaveBeenCalledWith(expect.stringContaining('PDF'), expect.objectContaining({ tenantId: 'tenant-a', error: 'settings unavailable' }));
  });
  it.each([null, undefined, ''])('does not substitute a default company for absent tenant %s', async tenantId => {
    await expect(loadCompanyName(tenantId)).resolves.toBeUndefined(); expect(m.settings).not.toHaveBeenCalled();
  });
});

describe('period PDF — totals and scope', () => {
  it('returns empty rows and zero totals without reading fallback crews', async () => {
    const data = await buildPeriodPdfData(period);
    expect(data).toMatchObject({ reports: [], totalPiles: 0, totalDrilling: 0, totalDowntime: 0 });
    expect(m.crews).not.toHaveBeenCalled();
    expect(m.reports).toHaveBeenCalledWith(period.dateFrom, period.dateTo, null, 'tenant-a', null);
  });
  it('excludes draft contributions from submitted production totals', async () => {
    m.reports.mockResolvedValue([
      report({ piles: [{ pileGrade: { name: 'C120', lengthMm: 12000 }, count: 2 }], drillings: [{ type: { name: 'Лидерное' }, count: 1, metersPerUnit: 3, meters: 3 }], downtimes: [{ reason: { name: 'Ожидание' }, duration: 0.25, comment: null }] }),
      report({ reportId: 'draft', status: 'draft', piles: [{ pileGrade: { name: 'C120' }, count: 999 }] }),
    ]);
    const data = await buildPeriodPdfData(period);
    expect(data).toMatchObject({ totalPiles: 2, totalDrilling: 3, totalDowntime: 0.25 });
  });
  it('filters to the requested equipment before totals and uses a tenant-scoped equipment label', async () => {
    m.reports.mockResolvedValue([{ ...report(), equipmentId: 'rig-a' }, { ...report({ reportId: 'other' }), equipmentId: 'rig-b' }]);
    m.equipment.mockResolvedValue({ name: 'Учебная', model: 'Модель' });
    const data = await buildPeriodPdfData({ ...period, equipmentId: 'rig-a' });
    expect(data.reports).toEqual([expect.objectContaining({reportId: 'report-a'})]); expect(data.equipmentLabel).toBe('Установка: Учебная (Модель)');
    expect(m.equipment).toHaveBeenCalledWith({ where: { id: 'rig-a', tenantId: 'tenant-a' }, select: { name: true, model: true } });
  });
  it('matches a fallback crew by both operator and site', async () => {
    m.reports.mockResolvedValue([report()]);
    m.crews.mockResolvedValue([
      { operatorId: 'operator-a', siteId: 'other-site', assistants: [{ name: 'Чужая площадка' }], equipment: null },
      { operatorId: 'operator-a', siteId: 'site-a', assistants: [{ name: 'Нужная бригада' }], equipment: null },
    ]);
    const data = await buildPeriodPdfData(period); expect(data.reports).toEqual([expect.objectContaining({assistantName: 'Нужная бригада'})]);
  });
});
