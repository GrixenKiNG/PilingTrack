import { describe, expect, it, vi } from 'vitest';

const execFile = vi.fn();

vi.mock('child_process', () => ({
  execFile,
}));

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
});
