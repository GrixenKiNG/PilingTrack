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
  });

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
  });

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
  });

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
  });

  it('does not mark the metres total when every grade has a length (F-R28-2)', async () => {
    const { generateSinglePdf } = await import('@/lib/pdf-generator');

    const rendered = await capturePdfText(async () => {
      await generateSinglePdf(
        singleReportWithPiles([{ pileGrade: { name: 'Свая 300', lengthMm: 12000 }, count: 3 }])
      );
    });

    expect(rendered).not.toContain('(неполный: у марки не задана длина)');
    expect(rendered).toContain('3 / 36.0');
  });

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
  });
});
