import { describe, expect, it, vi } from 'vitest';

const execFile = vi.fn();

vi.mock('child_process', () => ({
  execFile,
}));

/** Runs a PDF generation with pdfkit's text() captured, so the document body can be asserted. */
async function capturePdfText(run: () => Promise<void>): Promise<string[]> {
  const PDFDocument = (await import('pdfkit')).default;
  const rendered: string[] = [];
  const originalText = PDFDocument.prototype.text;
  // pdfkit 0.18 @types expose two text() overloads; the cast keeps the patch local.
  PDFDocument.prototype.text = function (this: typeof PDFDocument.prototype, text: string) {
    rendered.push(text);
    return this;
  } as typeof originalText;

  try {
    await run();
  } finally {
    PDFDocument.prototype.text = originalText;
  }

  return rendered;
}

const singleReportWithPiles = (
  piles: { pileGrade: { name: string; lengthMm?: number | null }; count: number }[]
) => ({
  reportId: 'report-123456',
  date: '2026-04-24',
  shiftStart: '08:00',
  shiftEnd: '20:00',
  shiftType: 'DAY',
  status: 'submitted',
  lastEditedByName: 'Иван Иванов',
  lastEditedByRole: 'OPERATOR',
  assistantName: 'Пётр Петров',
  equipmentName: 'LRH 100',
  user: { name: 'Иван Иванов' },
  site: { name: 'Объект 1' },
  piles,
  drillings: [],
  downtimes: [],
});

describe('pdf-generator', () => {
  it('generates a single-report PDF in-process', async () => {
    const { generateSinglePdf } = await import('@/lib/pdf-generator');

    const pdf = await generateSinglePdf({
      reportId: 'report-123456',
      date: '2026-04-24',
      shiftStart: '08:00',
      shiftEnd: '20:00',
      shiftType: 'DAY',
      status: 'submitted',
      lastEditedByName: 'Иван Иванов',
      lastEditedByRole: 'OPERATOR',
      assistantName: 'Пётр Петров',
      equipmentName: 'LRH 100',
      user: { name: 'Иван Иванов' },
      site: { name: 'Объект 1' },
      piles: [{ pileGrade: { name: 'Свая 300', lengthMm: 12000 }, count: 3 }],
      drillings: [{ type: { name: 'Лидерное' }, count: 1, metersPerUnit: 12, meters: 12 }],
      downtimes: [{ reason: { name: 'Погода' }, duration: 2, comment: 'Дождь' }],
    });

    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(1000);
    expect(execFile).not.toHaveBeenCalled();
  }, 30_000);

  it('generates a period PDF in-process', async () => {
    const { generatePeriodPdf } = await import('@/lib/pdf-generator');

    const pdf = await generatePeriodPdf({
      dateFrom: '2026-04-01',
      dateTo: '2026-04-24',
      siteId: 'site-1',
      totalPiles: 3,
      totalDrilling: 12,
      totalDowntime: 2,
      reports: [
        {
          reportId: 'report-123456',
          date: '2026-04-24',
          shiftType: 'DAY',
          status: 'submitted',
          assistantName: 'Пётр Петров',
          equipmentName: 'LRH 100',
          user: { name: 'Иван Иванов' },
          site: { name: 'Объект 1' },
          piles: [{ pileGrade: { name: 'Свая 300', lengthMm: 12000 }, count: 3 }],
          drillings: [{ type: { name: 'Лидерное' }, count: 1, meters: 12 }],
          downtimes: [{ reason: { name: 'Погода' }, duration: 2 }],
        },
      ],
    });

    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(1000);
    expect(execFile).not.toHaveBeenCalled();
  }, 30_000);

  it('prints downtime hours as on screen and totals them from raw durations (F-R28-1)', async () => {
    const PDFDocument = (await import('pdfkit')).default;
    const rendered: string[] = [];
    const originalText = PDFDocument.prototype.text;
    // pdfkit 0.18 @types expose two text() overloads; the cast keeps the patch local.
    PDFDocument.prototype.text = function (this: typeof PDFDocument.prototype, text: string) {
      rendered.push(text);
      return this;
    } as typeof originalText;

    try {
      const { generateSinglePdf } = await import('@/lib/pdf-generator');
      await generateSinglePdf({
        reportId: 'report-123456',
        date: '2026-04-24',
        shiftStart: '08:00',
        shiftEnd: '20:00',
        shiftType: 'DAY',
        status: 'submitted',
        lastEditedByName: 'Иван Иванов',
        lastEditedByRole: 'OPERATOR',
        assistantName: 'Пётр Петров',
        equipmentName: 'LRH 100',
        user: { name: 'Иван Иванов' },
        site: { name: 'Объект 1' },
        piles: [{ pileGrade: { name: 'Свая 300', lengthMm: 12000 }, count: 3 }],
        drillings: [],
        downtimes: [
          { reason: { name: 'Погода' }, duration: 1.25, comment: null },
          { reason: { name: 'Ожидание бетона' }, duration: 0.25, comment: null },
          { reason: { name: 'Ремонт' }, duration: 3, comment: null },
        ],
      });
    } finally {
      PDFDocument.prototype.text = originalText;
    }

    expect(rendered).toEqual(expect.arrayContaining(['1 ч 15 мин', '15 мин', '3 ч', '4 ч 30 мин']));
  }, 30_000);

  it('writes «длина марки не задана» instead of 0.0 metres for a grade without length (F-R28-2)', async () => {
    const { generateSinglePdf } = await import('@/lib/pdf-generator');

    const rendered = await capturePdfText(async () => {
      await generateSinglePdf(
        singleReportWithPiles([
          { pileGrade: { name: 'Свая без длины', lengthMm: null }, count: 7 },
          { pileGrade: { name: 'Свая 300', lengthMm: 12000 }, count: 3 },
        ])
      );
    });

    expect(rendered).toEqual(
      expect.arrayContaining(['длина марки не задана', '(неполный: у марки не задана длина)'])
    );
    // Ни одна ячейка метража не печатает 0.0 (шт остаются как были).
    expect(rendered).not.toContain('0.0');
    expect(rendered).toEqual(expect.arrayContaining(['7', '3']));
  }, 30_000);

  it('does not mark the metres total when every grade has a length (F-R28-2)', async () => {
    const { generateSinglePdf } = await import('@/lib/pdf-generator');

    const rendered = await capturePdfText(async () => {
      await generateSinglePdf(
        singleReportWithPiles([{ pileGrade: { name: 'Свая 300', lengthMm: 12000 }, count: 3 }])
      );
    });

    expect(rendered).not.toContain('(неполный: у марки не задана длина)');
    // Метраж идёт в общем формате «шт. / м.п.» (F-R51-FORMAT).
    expect(rendered).toContain('3 шт. / 36 м.п.');
  }, 30_000);

  it('marks the period metres total as incomplete when a grade has no length (F-R28-2)', async () => {
    const { generatePeriodPdf } = await import('@/lib/pdf-generator');

    const rendered = await capturePdfText(async () => {
      await generatePeriodPdf({
        dateFrom: '2026-04-01',
        dateTo: '2026-04-24',
        siteId: 'site-1',
        totalPiles: 7,
        totalDrilling: 0,
        totalDowntime: 0,
        reports: [
          {
            reportId: 'report-123456',
            date: '2026-04-24',
            shiftType: 'DAY',
            status: 'submitted',
            user: { name: 'Иван Иванов' },
            site: { name: 'Объект 1' },
            piles: [{ pileGrade: { name: 'Свая без длины', lengthMm: null }, count: 7 }],
            drillings: [],
            downtimes: [],
          },
        ],
      });
    });

    expect(rendered).toContain('(неполный: у марки не задана длина)');
  }, 30_000);

  it('печатает название компании из настроек в шапке PDF (F-R30-6)', async () => {
    const { generateSinglePdf, generatePeriodPdf } = await import('@/lib/pdf-generator');

    const single = await capturePdfText(async () => {
      await generateSinglePdf({
        ...singleReportWithPiles([{ pileGrade: { name: 'Свая 300', lengthMm: 12000 }, count: 3 }]),
        companyName: 'ООО «Орион»',
      });
    });
    expect(single).toContain('ООО «Орион»');

    const period = await capturePdfText(async () => {
      await generatePeriodPdf({
        dateFrom: '2026-04-01',
        dateTo: '2026-04-24',
        siteId: 'site-1',
        totalPiles: 3,
        totalDrilling: 12,
        totalDowntime: 2,
        reports: [],
        companyName: 'ООО «Орион»',
      });
    });
    expect(period).toContain('ООО «Орион»');
  }, 30_000);

  it('печатает установку в шапке сводного отчёта только при отборе по установке (F-R44-5)', async () => {
    const { generatePeriodPdf } = await import('@/lib/pdf-generator');

    const base = {
      dateFrom: '2026-04-01',
      dateTo: '2026-04-24',
      siteId: 'site-1',
      totalPiles: 0,
      totalDrilling: 0,
      totalDowntime: 0,
      reports: [],
    };

    const filtered = await capturePdfText(async () => {
      await generatePeriodPdf({ ...base, equipmentLabel: 'Установка: LRH 100 (Bauer BG 28)' });
    });
    expect(filtered).toContain('Установка: LRH 100 (Bauer BG 28)');

    const unfiltered = await capturePdfText(async () => {
      await generatePeriodPdf({ ...base });
    });
    expect(unfiltered.some((line) => line.startsWith('Установка:'))).toBe(false);
  }, 30_000);
});

/**
 * Числа PDF — по правилам продукта (Аудит 17, находка 4): разделитель дробной
 * части запятая, разряды тысяч — пробелом. Раньше здесь были `toFixed(1)` и
 * `String(int)`, то есть «12.5 м.п.» и «1200 м» в подшитом документе.
 */
describe('pdf-generator — числа ru-RU', () => {
  it('метры и метраж — с запятой, целые — с пробелом в разрядах', async () => {
    const { formatMeters, formatNumber, safeText } = await import('@/lib/pdf-generator/format');

    expect(formatMeters(12.5)).toBe('12,5');
    expect(formatNumber(1200)).toBe('1\u00A0200');
    expect(formatNumber(2.5)).toBe('2,5');
    expect(formatNumber(null)).toBe('0');
    expect(safeText('')).toBe('—');
  }, 30_000);
});

/**
 * Строки PDF собираются из format.ts и period-row.ts (T-PDF-FORMAT). Здесь
 * закреплены правила продукта: десятичная запятая и разрядный пробел в числах,
 * дата в виде ДД.ММ.ГГГГ, «—» вместо пустого значения — и проверено, что в
 * подшитый документ не попадают «NaN» и машинные даты.
 */
describe('pdf-generator — формат строк и итогов периода (T-PDF-FORMAT)', () => {
  it('числа и метры печатаются по-русски: запятая, разряды пробелом', async () => {
    const { formatMeters, formatNumber } = await import('@/lib/pdf-generator/format');

    expect(formatNumber(2832)).toBe('2\u00A0832');
    expect(formatNumber(2.5)).toBe('2,5');
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(null)).toBe('0');
    expect(formatNumber(undefined)).toBe('0');
    expect(formatMeters(12)).toBe('12,0');
    expect(formatMeters(12.5)).toBe('12,5');
    expect(formatMeters(0.25)).toBe('0,3');
  });

  it('safeText подставляет «—» вместо пустого значения и сжимает пробелы', async () => {
    const { safeText } = await import('@/lib/pdf-generator/format');

    expect(safeText(null)).toBe('—');
    expect(safeText(undefined)).toBe('—');
    expect(safeText('')).toBe('—');
    expect(safeText(0)).toBe('0');
    expect(safeText('  Иван\n\nИванов  ')).toBe('Иван Иванов');
  });

  it('safeText сохраняет длинное название целиком, не обрезая его', async () => {
    const { safeText } = await import('@/lib/pdf-generator/format');
    const name = 'ЖК «Северная долина», корпус 7, очередь 3, участок свайных работ у северного фасада';

    expect(safeText(name)).toBe(name);
    expect(safeText(`  ${name}\n\n  `)).toBe(name);
  });

  it('дата отчёта печатается как ДД.ММ.ГГГГ, пустая — как «—»', async () => {
    const { formatRuDate } = await import('@/lib/pdf-generator/format');

    expect(formatRuDate('2026-04-24')).toBe('24.04.2026');
    expect(formatRuDate('')).toBe('—');
  });

  it('служебные подписи: номер, статус, смена, автор правки', async () => {
    const { editorLabel, shiftLabel, shortId, statusLabel } = await import('@/lib/pdf-generator/format');

    expect(shortId('report-123456')).toBe('REPORT-1');
    expect(shortId('')).toBe('—');
    expect(statusLabel('submitted')).toBe('Отправлен');
    expect(statusLabel('')).toBe('—');
    expect(shiftLabel('NIGHT')).toBe('Ночная');
    expect(shiftLabel('')).toBe('—');
    expect(editorLabel('OPERATOR', 'Иван Иванов')).toBe('Оператор: Иван Иванов');
    expect(editorLabel('ADMIN', 'Пётр Петров')).toBe('Администратор: Пётр Петров');
    expect(editorLabel(null, 'Иван Иванов')).toBe('Оператор: Иван Иванов');
    expect(editorLabel('OPERATOR', null)).toBe('—');
  });

  it('итоги периода считаются из строк, пустые списки дают 0, а не NaN', async () => {
    const { sumDowntime, sumDrilling, sumPiles, toPeriodReportRow } = await import(
      '@/lib/pdf-generator/period-row'
    );

    expect(sumPiles({ piles: [{ count: 3 }, { count: 2 }] })).toBe(5);
    expect(sumPiles({})).toBe(0);
    expect(sumPiles({ piles: null })).toBe(0);
    expect(sumPiles({ piles: [{ count: null }, { count: undefined }] })).toBe(0);
    expect(sumDrilling({ drillings: [{ meters: 12 }, { meters: 0.5 }] })).toBe(12.5);
    expect(sumDrilling({})).toBe(0);
    expect(sumDowntime({ downtimes: [{ duration: 1.25 }, { duration: 3 }] })).toBe(4.25);
    expect(sumDowntime({})).toBe(0);
    expect(toPeriodReportRow(null)).toEqual({});
    expect(toPeriodReportRow('строка')).toEqual({});
    expect(sumPiles(toPeriodReportRow(undefined))).toBe(0);
  });

  it('safeText печатает «—» вместо «NaN»/«Infinity», сохраняя конечные числа (T-PDF-FORMAT)', async () => {
    const { safeText } = await import('@/lib/pdf-generator/format');

    expect(safeText(NaN)).toBe('—');
    expect(safeText(Infinity)).toBe('—');
    expect(safeText(-Infinity)).toBe('—');
    // Конечный 0 — не пустота: печатается как «0», а не «—».
    expect(safeText(0)).toBe('0');
    expect(safeText(12.5)).toBe('12.5');
  });

  it('safeText оставляет «—» вместо строки из одних пробелов (T-PDF-FORMAT)', async () => {
    const { safeText } = await import('@/lib/pdf-generator/format');

    expect(safeText('   ')).toBe('—');
    expect(safeText('\n\t  ')).toBe('—');
  });

  it('formatRuDate печатает «—» вместо битой даты и не сдвигает валидную (T-PDF-FORMAT)', async () => {
    const { formatRuDate } = await import('@/lib/pdf-generator/format');

    expect(formatRuDate('abc')).toBe('—');
    expect(formatRuDate('2026-04')).toBe('—');
    // Невозможная календарная дата не нормализуется молча в другой месяц.
    expect(formatRuDate('2026-02-30')).toBe('—');
    expect(formatRuDate('2026-13-01')).toBe('—');
    // Валидная дата — в правильном дне независимо от системного пояса.
    expect(formatRuDate('2026-04-24')).toBe('24.04.2026');
  });
});
