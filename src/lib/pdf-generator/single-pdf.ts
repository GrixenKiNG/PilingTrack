import {
  addEmptyState,
  addHeader,
  addInfoGrid,
  addMetricStrip,
  addSectionTitle,
  addTable,
} from './components';
import {
  editorLabel,
  formatMeters,
  formatNumber,
  formatRuDate,
  shiftLabel,
  shortId,
  statusLabel,
} from './format';
import { renderPdf } from './render';
import type { SingleReportData } from './types';

export async function generateSinglePdf(data: SingleReportData): Promise<Buffer> {
  return renderPdf((doc) => {
    const pileLengthFromName = (name: string) => {
      const m = name.match(/\d{3}/);
      return m ? Number(m[0]) / 10 : 0;
    };
    const pileMetersOf = (pile: { pileGrade?: { name: string }; metersPerUnit?: number }) =>
      pile.metersPerUnit && pile.metersPerUnit > 0
        ? pile.metersPerUnit
        : pileLengthFromName(pile.pileGrade?.name || '');
    const totalPiles = data.piles.reduce((sum, pile) => sum + (pile.count || 0), 0);
    const totalPileMeters = data.piles.reduce(
      (sum, pile) => sum + (pile.count || 0) * pileMetersOf(pile),
      0
    );
    const totalDrillingCount = data.drillings.reduce((sum, drilling) => sum + (drilling.count || 1), 0);
    const totalDrilling = data.drillings.reduce((sum, drilling) => sum + (drilling.meters || 0), 0);
    const totalDowntime = data.downtimes.reduce((sum, downtime) => sum + (downtime.duration || 0), 0);

    addHeader(doc, 'РАБОЧИЙ ОТЧЁТ ПО СВАЙНЫМ РАБОТАМ', `№ ${shortId(data.reportId)} | ${formatRuDate(data.date)}`);
    addInfoGrid(doc, [
      ['Объект', data.site?.name || '—', 'Дата', formatRuDate(data.date)],
      ['Оператор', data.user?.name || '—', 'Смена', `${shiftLabel(data.shiftType)} ${data.shiftStart || ''}-${data.shiftEnd || ''}`],
      ['Помощник', data.assistantName || '—', 'Оборудование', data.equipmentName || '—'],
      ['Статус', statusLabel(data.status), 'Изменил', editorLabel(data.lastEditedByRole, data.lastEditedByName)],
    ]);

    const hasWork = data.piles.length > 0 || data.drillings.length > 0 || data.downtimes.length > 0;
    if (!hasWork) {
      addEmptyState(doc, 'В отчёте нет производственных работ или простоев.');
      return;
    }

    addMetricStrip(doc, [
      ['Свай забито', `${formatNumber(totalPiles)} / ${formatMeters(totalPileMeters)}`, 'шт / м.п.'],
      ['Бурение', `${formatNumber(totalDrillingCount)} / ${formatMeters(totalDrilling)}`, 'шт / м.п.'],
      ['Простои', formatNumber(totalDowntime), 'ч'],
    ]);

    if (data.piles.length > 0) {
      addSectionTitle(doc, 'Свайные работы');
      addTable(
        doc,
        ['Марка сваи', 'Кол-во', 'Метров на сваю', 'Всего м.п.'],
        data.piles.map((pile) => {
          const mpu = pileMetersOf(pile);
          return [
            pile.pileGrade?.name || '—',
            formatNumber(pile.count),
            formatMeters(mpu),
            formatMeters((pile.count || 0) * mpu),
          ];
        }),
        [0.46, 0.16, 0.18, 0.2]
      );
    }

    if (data.drillings.length > 0) {
      addSectionTitle(doc, 'Лидерное бурение');
      addTable(
        doc,
        ['Тип', 'Кол-во', 'Метров на ед.', 'Всего м.п.'],
        data.drillings.map((drilling) => [
          drilling.type?.name || '—',
          formatNumber(drilling.count || 1),
          formatMeters(drilling.metersPerUnit || 0),
          formatMeters(drilling.meters || 0),
        ]),
        [0.46, 0.16, 0.18, 0.2]
      );
    }

    if (data.downtimes.length > 0) {
      addSectionTitle(doc, 'Простои');
      addTable(
        doc,
        ['Причина', 'Длительность', 'Комментарий'],
        data.downtimes.map((downtime) => [
          downtime.reason?.name || '—',
          `${formatNumber(downtime.duration)} ч`,
          downtime.comment || '—',
        ]),
        [0.48, 0.18, 0.34]
      );
    }
  });
}
