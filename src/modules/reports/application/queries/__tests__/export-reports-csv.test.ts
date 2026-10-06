/**
 * exportReportsCsv — tenant scoping regression.
 *
 * Pre-existing IDOR: the where-clause built no tenantId filter at all, so
 * any authenticated user with `reports.export` could pull every tenant's
 * report data via /api/reports/export. Fail-closed fix mirrors the rest of
 * the codebase's tenant-scoping convention.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Sheet = { name: string; rows: (string | number | null)[][] };

const { findManyMock, getSettingsMock, sheets } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  getSettingsMock: vi.fn(),
  sheets: { current: [] as Sheet[] },
}));

vi.mock('@/lib/db', () => ({ db: { report: { findMany: findManyMock } } }));

vi.mock('@/modules/settings', () => ({ getSettings: getSettingsMock }));

vi.mock('@/lib/xlsx-writer', () => ({
  buildXlsx: (built: Sheet[]) => {
    sheets.current = built;
    return Buffer.from('');
  },
}));

import { exportReportsCsv, exportReportsXlsx } from '../report-query.service';

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

/**
 * Статус смены в выгрузке (F-O6, решение владельца 26.09.2026). Незакрытая смена
 * (черновик) остаётся в файле, но обязана быть помечена: иначе строка черновика
 * читается как обычная сдача, а аналитика черновики не считает — «общее» число
 * за один период расходится. Состав строк при этом не меняется.
 */
describe('exportReportsCsv — статус смены', () => {
  const report = (status: string) => ({
    reportId: 'R-1', date: '2026-09-26', shiftType: 'DAY', status,
    site: { name: 'Объект' }, user: { name: 'Иванов' },
    crew: null, equipment: { name: 'Banut 655' },
    piles: [{ count: 1, pileGrade: { name: 'С300', lengthMm: 12000 } }],
    drillings: [], downtimes: [],
  });

  beforeEach(() => { findManyMock.mockReset(); });

  it('печатает колонку «Статус» между сменой и объектом', async () => {
    findManyMock.mockResolvedValue([report('submitted')]);

    const csv = await exportReportsCsv({ tenantId: 'tenant-a' });

    expect(csv).toContain('Дата;Смена;Статус;Объект;');
  });

  it('черновик подписан «черновик (смена не сдана)», сданный — «сдан»', async () => {
    findManyMock.mockResolvedValue([report('draft')]);
    const draftCsv = await exportReportsCsv({ tenantId: 'tenant-a' });
    expect(draftCsv).toContain('"черновик (смена не сдана)"');

    findManyMock.mockResolvedValue([report('submitted')]);
    const submittedCsv = await exportReportsCsv({ tenantId: 'tenant-a' });
    expect(submittedCsv).toContain('"сдан"');
  });
});

/**
 * Метраж свай (F-R32-2). Экран «Отчёты» показывает «шт/м.п.», а выгрузка
 * раньше содержала только штуки — по файлу экранный итог было не сверить.
 * Длина берётся из PileGrade.lengthMm через lib/pile-length (единственный
 * источник), имя марки не парсится, а пустая длина даёт пояснение, не «0.0».
 */
describe('exportReportsCsv — метраж свай', () => {
  beforeEach(() => { findManyMock.mockReset(); });

  it('печатает «Свай, м.п.» и метраж марки без длины (F-R32-2)', async () => {
    findManyMock.mockResolvedValue([{
      reportId: 'R-1', date: '2026-08-17', shiftType: 'DAY',
      site: { name: 'Объект' }, user: { name: 'Иванов' },
      crew: null, equipment: { name: 'Banut 655' },
      piles: [
        { count: 3, pileGrade: { name: 'С300', lengthMm: 12000 } },
        { count: 2, pileGrade: { name: 'С90.30', lengthMm: null } },
      ],
      drillings: [], downtimes: [],
    }]);

    const csv = await exportReportsCsv({ tenantId: 'tenant-a' });

    expect(csv).toContain('Кол-во свай;Свай, м.п.;');
    // 3 × 12.0 м = 36.0 м.п. у марки с длиной — доли через запятую (находка 13):
    // русский Excel с «;» читает «36.0» как текст и колонку не суммирует.
    expect(csv).toContain('"36,0"');
    expect(csv).not.toContain('"36.0"');
    expect(csv).toContain('"длина марки не задана"');
  });
});

/**
 * Смена (находка 19). Раньше `=== 'NIGHT' ? … : 'Дневная'` печатало любое
 * чужое значение как «Дневная» — выгрузка молча подменяла смену.
 */
describe('exportReportsCsv — подпись смены', () => {
  const reportOn = (shiftType: string | null) => ({
    reportId: 'R-1', date: '2026-08-17', shiftType,
    site: { name: 'Объект' }, user: { name: 'Иванов' },
    crew: null, equipment: { name: 'Banut 655' },
    piles: [], drillings: [],
    downtimes: [{ duration: 2, comment: '', reason: { name: 'Ремонт' } }],
  });

  beforeEach(() => { findManyMock.mockReset(); });

  it.each([
    ['DAY', 'Дневная'],
    ['NIGHT', 'Ночная'],
    ['EVENING', 'EVENING'],
  ])('смена %s печатается как «%s»', async (shiftType, expected) => {
    findManyMock.mockResolvedValue([reportOn(shiftType)]);

    const csv = await exportReportsCsv({ tenantId: 'tenant-a' });

    expect(csv).toContain(`"${expected}"`);
  });

  it('чужое значение смены не выдаётся за дневную', async () => {
    findManyMock.mockResolvedValue([reportOn('EVENING')]);

    const csv = await exportReportsCsv({ tenantId: 'tenant-a' });

    expect(csv).not.toContain('"Дневная"');
  });
});

/**
 * Лист «Детализация» в .xlsx (находки 13-14). «Свай, м.п.» — числовая колонка:
 * текст «длина марки не задана» в ней делал весь лист текстовым, поэтому без
 * длины марки ячейка пустая, а пояснение едет в отдельное «Примечание», как на
 * листе «Итоги».
 */
describe('exportReportsXlsx — числовая колонка «Свай, м.п.»', () => {
  const report = {
    reportId: 'R-1', date: '2026-08-17', shiftType: 'DAY', status: 'submitted',
    site: { name: 'Объект' }, user: { name: 'Иванов' },
    crew: null, equipment: { name: 'Banut 655' },
    piles: [
      { count: 3, pileGrade: { name: 'С300', lengthMm: 12000 } },
      { count: 2, pileGrade: { name: 'С90.30', lengthMm: null } },
    ],
    drillings: [], downtimes: [], endingFuelPercent: null,
  };

  beforeEach(() => {
    sheets.current = [];
    findManyMock.mockReset();
    findManyMock.mockResolvedValue([report]);
    getSettingsMock.mockReset();
    getSettingsMock.mockResolvedValue({ timezone: 'Europe/Moscow', companyName: '', inn: '' });
  });

  it('без длины марки ячейка пуста, пояснение — в «Примечании»', async () => {
    await exportReportsXlsx({ tenantId: 'tenant-a' });

    const detail = sheets.current.find((sheet) => sheet.name === 'Детализация');
    if (!detail) throw new Error('листа «Детализация» нет в выгрузке');
    const header = detail.rows.find((row) => row[0] === 'ID отчёта');
    if (!header) throw new Error('шапки нет на листе «Детализация»');
    const metersCol = header.indexOf('Свай, м.п.');
    const noteCol = header.indexOf('Примечание');
    expect(noteCol).toBeGreaterThan(-1);

    const rows = detail.rows.filter((row) => row[0] === 'R-1');
    // Марка без длины (2-я строка): пустая ячейка вместо текста.
    expect(rows[1][metersCol]).toBeNull();
    expect(rows[1][noteCol]).toBe('длина марки не задана');
    // Марка с длиной: число и пустое примечание.
    expect(rows[0][metersCol]).toBe(36);
    expect(rows[0][noteCol]).toBe('');
  });
});

/**
 * Дробные значения и запятая (D-20260930-007). Разделитель полей в выгрузке —
 * «;» (см. csvCell), значит дробная часть обязана быть через запятую: иначе
 * русский Excel читает «16.7» как текст и колонка не суммируется. Целые
 * остаются целыми — «2», а не «2,0».
 */
describe('exportReportsCsv — дробные значения через запятую', () => {
  const report = (drillMeters: number, duration: number) => ({
    reportId: 'R-1', date: '2026-08-17', shiftType: 'DAY', status: 'submitted',
    site: { name: 'Объект' }, user: { name: 'Иванов' },
    crew: null, equipment: { name: 'Banut 655' },
    piles: [],
    drillings: [{ count: 1, meters: drillMeters, type: { name: 'Бурение' } }],
    downtimes: [{ duration, comment: '', reason: { name: 'Ремонт' } }],
  });

  beforeEach(() => { findManyMock.mockReset(); });

  it('пишет метры бурения и часы простоя через запятую', async () => {
    findManyMock.mockResolvedValue([report(16.7, 1.5)]);

    const csv = await exportReportsCsv({ tenantId: 'tenant-a' });

    expect(csv).toContain('"16,7"');
    expect(csv).not.toContain('"16.7"');
    expect(csv).toContain('"1,5"');
    expect(csv).not.toContain('"1.5"');
    // Заголовок колонок не поехал: значения остались в своих колонках.
    expect(csv).toContain('Метры бурения;Причина простоя;Часы простоя');
  });

  it('целые не превращает в «2,0»', async () => {
    findManyMock.mockResolvedValue([report(16, 2)]);

    const csv = await exportReportsCsv({ tenantId: 'tenant-a' });

    expect(csv).toContain('"16"');
    expect(csv).toContain('"2"');
    expect(csv).not.toContain('"16,0"');
    expect(csv).not.toContain('"2,0"');
  });
});

/**
 * XLSX: числа обязаны уезжать числовой ячейкой, а не строкой «16.7»
 * (D-20260930-007). Разделитель дробной части Excel подставляет сам по локали
 * пользователя, поэтому в самом файле число лежит точкой — это формат, а не
 * текст, и колонка с ним суммируется и фильтруется.
 */
describe('exportReportsXlsx — дробные числа числовыми ячейками', () => {
  const report = {
    reportId: 'R-1', date: '2026-08-17', shiftType: 'DAY', status: 'submitted',
    site: { name: 'Объект' }, user: { name: 'Иванов' },
    crew: null, equipment: { name: 'Banut 655' },
    piles: [{ count: 3, pileGrade: { name: 'С300', lengthMm: 12000 } }],
    drillings: [{ count: 1, meters: 16.7, type: { name: 'Бурение' } }],
    downtimes: [{ duration: 1.5, comment: '', reason: { name: 'Ремонт' } }],
    endingFuelPercent: 42.5,
  };

  beforeEach(() => {
    sheets.current = [];
    findManyMock.mockReset();
    findManyMock.mockResolvedValue([report]);
    getSettingsMock.mockReset();
    getSettingsMock.mockResolvedValue({ timezone: 'Europe/Moscow', companyName: '', inn: '' });
  });

  it('метры, часы и топливо — тип number, а не строка', async () => {
    await exportReportsXlsx({ tenantId: 'tenant-a' });

    const detail = sheets.current.find((sheet) => sheet.name === 'Детализация');
    if (!detail) throw new Error('листа «Детализация» нет в выгрузке');
    const header = detail.rows.find((row) => row[0] === 'ID отчёта');
    if (!header) throw new Error('шапки нет на листе «Детализация»');
    const rows = detail.rows.filter((row) => row[0] === 'R-1');
    const drilling = rows[rows.findIndex((row) => row[header.indexOf('Тип бурения')] === 'Бурение')];
    const downtime = rows[rows.findIndex((row) => row[header.indexOf('Причина простоя')] === 'Ремонт')];

    expect(typeof rows[0][header.indexOf('Свай, м.п.')]).toBe('number');
    expect(rows[0][header.indexOf('Свай, м.п.')]).toBe(36);
    expect(drilling[header.indexOf('Метры бурения')]).toBe(16.7);
    expect(downtime[header.indexOf('Часы простоя')]).toBe(1.5);

    const totals = sheets.current.find((sheet) => sheet.name === 'Итоги');
    if (!totals) throw new Error('листа «Итоги» нет в выгрузке');
    const totalsHeader = totals.rows[0];
    const totalsRow = totals.rows.find((row) => row[0] === 'R-1');
    if (!totalsRow) throw new Error('строки итогов нет');
    expect(totalsRow[totalsHeader.indexOf('Бурение, м')]).toBe(16.7);
    expect(totalsRow[totalsHeader.indexOf('Остаток топлива, %')]).toBe(42.5);
  });
});

/**
 * Формат даты. `Report.date` — строка БД `ГГГГ-ММ-ДД`, но выгрузку открывает
 * человек: в колонке «Дата» должно стоять `ДД.ММ.ГГГГ` (Аудит 17, находка 5).
 */
describe('exportReportsCsv — формат даты', () => {
  const reportOn = (date: string) => ({
    reportId: 'R-1', date, shiftType: 'DAY',
    site: { name: 'Объект' }, user: { name: 'Иванов' },
    crew: { name: 'Экипаж', equipment: { name: 'Banut 655' } },
    piles: [], drillings: [],
    downtimes: [{ duration: 2, comment: '', reason: { name: 'Ремонт' } }],
  });

  beforeEach(() => { findManyMock.mockReset(); });

  it('пишет дату как ДД.ММ.ГГГГ, а не ISO-строкой из БД', async () => {
    findManyMock.mockResolvedValue([reportOn('2026-08-17')]);

    const csv = await exportReportsCsv({ tenantId: 'tenant-a' });

    expect(csv).toContain('"17.08.2026"');
    expect(csv).not.toContain('2026-08-17');
  });
});

it('I05: XLSX drafts remain labelled on a separate sheet, then move to submitted totals', async () => {
  const report = { reportId: 'draft-1', date: '2026-10-02', shiftType: 'DAY', status: 'draft',
    site: { name: 'Site' }, user: { name: 'Operator' }, crew: null, equipment: null,
    piles: [{ count: 2, pileGrade: { name: 'Grade', lengthMm: 6000 } }], drillings: [], downtimes: [] };
  findManyMock.mockReset().mockResolvedValue([report]);
  getSettingsMock.mockResolvedValue({ timezone: 'Europe/Moscow', companyName: '', inn: '' });
  await exportReportsXlsx({ tenantId: 'orion' });
  expect(sheets.current.find(sheet => sheet.name === 'Итоги')?.rows).toHaveLength(1);
  const drafts = sheets.current.find(sheet => sheet.name === 'Черновики');
  expect(drafts?.rows[1]).toContain('draft-1');
  expect(drafts?.rows[1]).toContain('черновик (смена не сдана)');
  report.status = 'submitted';
  await exportReportsXlsx({ tenantId: 'orion' });
  expect(sheets.current.find(sheet => sheet.name === 'Черновики')).toBeUndefined();
  const totals = sheets.current.find(sheet => sheet.name === 'Итоги');
  expect(totals?.rows[1][6]).toBe(2);
  expect(totals?.rows[1][7]).toBe(12);
});