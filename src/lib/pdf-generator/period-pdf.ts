import {
  addEmptyState,
  addHeader,
  addMetricStrip,
  addPeriodTable,
  addReportBreakdown,
  addSectionTitle,
} from './components';
import { formatMeters, formatNumber, formatRuDate } from './format';
import { toPeriodReportRow } from './period-row';
import { renderPdf } from './render';
import type { PeriodPdfData } from './types';

export async function generatePeriodPdf(data: PeriodPdfData): Promise<Buffer> {
  return renderPdf((doc) => {
    const reports = data.reports.map(toPeriodReportRow);
    const totalDrillingCount = reports.reduce(
      (sum, report) =>
        sum + (report.drillings || []).reduce((inner, drilling) => inner + (drilling.count || 1), 0),
      0
    );
    const pileLengthFromName = (name: string) => {
      const m = name.match(/\d{3}/);
      return m ? Number(m[0]) / 10 : 0;
    };
    const totalPileMeters = reports.reduce(
      (sum, report) =>
        sum + (report.piles || []).reduce(
          (inner, pile) => {
            const mpu = pile.metersPerUnit && pile.metersPerUnit > 0
              ? pile.metersPerUnit
              : pileLengthFromName(pile.pileGrade?.name || '');
            return inner + (pile.count || 0) * mpu;
          },
          0,
        ),
      0,
    );

    addHeader(doc, 'СВОДНЫЙ ОТЧЁТ ЗА ПЕРИОД', `${formatRuDate(data.dateFrom)} - ${formatRuDate(data.dateTo)}`);
    addMetricStrip(doc, [
      ['Отчётов', String(reports.length), 'шт'],
      ['Свай забито', `${formatNumber(data.totalPiles)} / ${formatMeters(totalPileMeters)}`, 'шт / м.п.'],
      ['Бурение', `${formatNumber(totalDrillingCount)} / ${formatMeters(data.totalDrilling)}`, 'шт / м.п.'],
      ['Простои', formatNumber(data.totalDowntime), 'ч'],
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
