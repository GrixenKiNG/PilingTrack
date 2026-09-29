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
import { toPeriodReportRow } from './period-row';
import { renderPdf } from './render';
import { formatCountMeters } from '@/lib/format';
import { formatDowntimeHours } from '@/lib/downtime-hours';
import { pileLengthMeters } from '@/lib/pile-length';
import type { PeriodPdfData } from './types';

export async function generatePeriodPdf(data: PeriodPdfData): Promise<Buffer> {
  return renderPdf((doc) => {
    const reports = data.reports.map(toPeriodReportRow);
    const totalDrillingCount = reports.reduce(
      (sum, report) =>
        sum + (report.drillings || []).reduce((inner, drilling) => inner + (drilling.count || 1), 0),
      0
    );
    const totalPileMeters = reports.reduce(
      (sum, report) =>
        sum + (report.piles || []).reduce(
          (inner, pile) => inner + (pile.count || 0) * pileLengthMeters({ gradeLengthMm: pile.pileGrade?.lengthMm }),
          0,
        ),
      0,
    );
    const hasPilesWithoutLength = reports.some((report) =>
      (report.piles || []).some((pile) => pileLengthMeters({ gradeLengthMm: pile.pileGrade?.lengthMm }) === 0),
    );

    addHeader(doc, 'СВОДНЫЙ ОТЧЁТ ЗА ПЕРИОД', `${formatRuDate(data.dateFrom)} - ${formatRuDate(data.dateTo)}`, data.companyName, data.equipmentLabel);
    addMetricStrip(doc, [
      ['Отчётов', String(reports.length), 'шт'],
      ['Свай забито', formatCountMeters(data.totalPiles, totalPileMeters), '', hasPilesWithoutLength ? PILE_METERS_INCOMPLETE_NOTE : undefined],
      ['Бурение', formatCountMeters(totalDrillingCount, data.totalDrilling), ''],
      ['Простои', formatDowntimeHours(data.totalDowntime), ''],
    ]);

    if (reports.length === 0) {
      addEmptyState(doc, 'За выбранный период отчётов нет.');
      return;
    }

    addSectionTitle(doc, 'Список отчётов');
    addPeriodTable(doc, reports);

    addSectionTitle(doc, 'Детализация работ');
    reports.forEach((report, index) => addReportBreakdown(doc, report, index + 1));
  });
}
