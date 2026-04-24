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
      piles: [{ pileGrade: { name: 'Свая 300' }, count: 3, metersPerUnit: 12 }],
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
          piles: [{ pileGrade: { name: 'Свая 300' }, count: 3, metersPerUnit: 12 }],
          drillings: [{ type: { name: 'Лидерное' }, count: 1, meters: 12 }],
          downtimes: [{ reason: { name: 'Погода' }, duration: 2 }],
        },
      ],
    });

    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(1000);
    expect(execFile).not.toHaveBeenCalled();
  });
});
