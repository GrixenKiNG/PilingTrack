import { getSettings } from '@/modules/settings';
import type { XlsxCell } from '@/lib/xlsx-writer';
import { PILE_JOURNAL_EXPORT_LIMIT, type PileJournalFilters } from './pile-journal-types';
import { listPilePassports } from './pile-journal-list';
import { pileJournalHeader } from './pile-journal-totals';
import { printDay } from './pile-journal-export';
import { BLANK, type Form41Input } from './pile-journal-form41';

const SHIFT_TEXT: Record<string, string> = { DAY: 'дневная', NIGHT: 'ночная' };

const HEAD: string[] = [
  '№ п/п', '№ свай по плану свайного поля', 'Тип сваи', 'Дата, смена',
  'Глубина забивки по проекту, см', 'Глубина забивки фактически, см', 'Тип молота',
  'Общее количество ударов', 'Отказ от 1 удара при забивке, см', 'Отказ от 1 удара при добивке, см',
  'Примечания',
];

/**
 * Лист формы № 2.5 ВСН 012-88 (часть II) «Сводная ведомость забитых свай».
 *
 * Колонки — по бланку заказчика. Глубина забивки по проекту в паспорте сваи не
 * хранится, колонка остаётся пустой. Отказ свай, добитых повторно, идёт в колонку
 * «при добивке», остальных — «при забивке». Сваи без паспорта (пачкой) в
 * ведомость не входят: у них нет номера и замеров, их число печатаем.
 */
export function svodRows({ rows, header, organisation, truncated, timezone }: Form41Input): XlsxCell[][] {
  const piles = rows.filter((row) => row.hasPassport);
  const skipped = rows.length - piles.length;
  const numbers = piles.map((row) => row.pileNumber).filter((n): n is string => n !== null);

  return [
    ['Форма № 2.5', '', '', '', '', '', 'Основание: ВСН 012-88 (часть II)'],
    ['Заказчик', BLANK],
    ['Подрядчик', organisation || BLANK],
    ['Субподрядчик', BLANK],
    ['Строительство', header.siteNames.join(', ') || BLANK],
    ['Объект', header.siteNames.join(', ') || BLANK],
    [],
    ['СВОДНАЯ ВЕДОМОСТЬ ЗАБИТЫХ СВАЙ'],
    ['(с №', numbers[0] ?? BLANK, 'по №', numbers[numbers.length - 1] ?? BLANK, ')'],
    ['Начало', header.dateFrom ?? BLANK, 'Окончание', header.dateTo ?? BLANK],
    [],
    HEAD,
    HEAD.map((_, index) => index + 1),
    ...piles.map((row, index): XlsxCell[] => {
      const refusalCm = row.refusalMm === null ? '' : Number((row.refusalMm / 10).toFixed(2));
      const shift = row.shiftType ? SHIFT_TEXT[row.shiftType] ?? row.shiftType : '';
      return [
        index + 1,
        row.pileNumber ?? '',
        row.pileGradeName,
        [printDay(row.drivenAt, timezone), shift].filter(Boolean).join(', '),
        '',
        row.drivenDepthM === null ? '' : Math.round(row.drivenDepthM * 100),
        row.hammerType ?? '',
        row.totalBlows,
        row.redriven ? '' : refusalCm,
        row.redriven ? refusalCm : '',
        [row.isDraft ? 'черновик отчёта' : null, row.note].filter(Boolean).join('; '),
      ];
    }),
    [],
    ...(skipped > 0 ? [[`Свай без паспорта в ведомость не включено: ${skipped} (записаны пачкой, номеров и замеров нет)`]] : []),
    ...(truncated ? [[`Показаны первые ${PILE_JOURNAL_EXPORT_LIMIT} записей — сузьте период или объект`]] : []),
    ['Производитель работ', BLANK, '(должность, фамилия, инициалы)', '(подпись)', '(дата)'],
  ];
}

/** Сводная ведомость забитых свай в .xlsx по тем же фильтрам, что и журнал. */
export async function exportPileSvodXlsx(filters: PileJournalFilters): Promise<Buffer> {
  const { buildXlsx } = await import('@/lib/xlsx-writer');
  const { timezone, companyName } = await getSettings(filters.tenantId);
  const { rows, truncated, totals } = await listPilePassports({
    ...filters,
    limit: PILE_JOURNAL_EXPORT_LIMIT,
    timezone,
  });
  return buildXlsx([
    {
      name: 'Форма 2.5',
      rows: svodRows({
        rows,
        header: pileJournalHeader(rows, totals, timezone),
        organisation: companyName ?? '',
        truncated,
        timezone,
      }),
    },
  ]);
}
