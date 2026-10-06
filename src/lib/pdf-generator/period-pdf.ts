import { isSubmittedReport } from '@/lib/report-status';
import {
  PILE_METERS_INCOMPLETE_NOTE,
  addEmptyState,
  addHeader,
  addMetricStrip,
  addPeriodTable,
  addReportBreakdown,
  addSectionTitle,
} from './components';
import { formatRuDate } from './format';
import { toPeriodReportRow, sumPiles, sumDrilling, sumDowntime } from './period-row';
import { renderPdf } from './render';
import { formatCountMeters } from '@/lib/format';
import { formatDowntimeHours } from '@/lib/downtime-hours';
import { pileLengthMeters } from '@/lib/pile-length';
import type { PeriodPdfData } from './types';

export async function generatePeriodPdf(data: PeriodPdfData): Promise<Buffer> {
  return renderPdf((doc) => {
    const reports = data.reports.map(toPeriodReportRow);
    const submittedReports = reports.filter(isSubmittedReport);
    const totalDrillingCount = submittedReports.reduce(
      (sum, report) =>
        sum + (report.drillings || []).reduce((inner, drilling) => inner + (drilling.count || 1), 0),
      0
    );
    const totalPileMeters = submittedReports.reduce(
      (sum, report) =>
        sum + (report.piles || []).reduce(
          (inner, pile) => inner + (pile.count || 0) * pileLengthMeters({ gradeLengthMm: pile.pileGrade?.lengthMm }),
          0,
        ),
      0,
    );
    const hasPilesWithoutLength = submittedReports.some((report) =>
      (report.piles || []).some((pile) => pileLengthMeters({ gradeLengthMm: pile.pileGrade?.lengthMm }) === 0),
    );

    addHeader(doc, 'СВОДНЫЙ ОТЧЁТ ЗА ПЕРИОД', `${formatRuDate(data.dateFrom)} - ${formatRuDate(data.dateTo)}`, data.companyName, data.equipmentLabel);
    addMetricStrip(doc, [
      ['Отчётов', String(submittedReports.length), 'шт'],
      ['Свай забито', formatCountMeters(submittedReports.reduce((sum, report) => sum + sumPiles(report), 0), totalPileMeters), '', hasPilesWithoutLength ? PILE_METERS_INCOMPLETE_NOTE : undefined],
      ['Бурение', formatCountMeters(totalDrillingCount, submittedReports.reduce((sum, report) => sum + sumDrilling(report), 0)), ''],
      ['Простои', formatDowntimeHours(submittedReports.reduce((sum, report) => sum + sumDowntime(report), 0)), ''],
    ]);

    if (reports.length === 0) {
      addEmptyState(doc, 'За выбранный период отчётов нет.');
      return;
    }

    if (submittedReports.length > 0) {
      addSectionTitle(doc, 'Отправленные отчёты');
      addPeriodTable(doc, submittedReports);
    }
    const drafts = reports.filter((report) => !isSubmittedReport(report));
    if (drafts.length > 0) {
      addSectionTitle(doc, 'Черновики — не входят в итоги');
      addPeriodTable(doc, drafts);
    }

    addSectionTitle(doc, 'Детализация работ');
    reports.forEach((report, index) => addReportBreakdown(doc, report, index + 1));
  });
}
