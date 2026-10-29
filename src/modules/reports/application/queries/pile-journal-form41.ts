import { getSettings } from '@/modules/settings';
import type { XlsxCell } from '@/lib/xlsx-writer';
import {
  PILE_JOURNAL_EXPORT_LIMIT,
  type PileJournalFilters,
  type PileJournalHeader,
  type PilePassportRow,
} from './pile-journal-types';
import { listPilePassports } from './pile-journal-list';
import { pileJournalHeader } from './pile-journal-totals';
import { printDay } from './pile-journal-export';

/** Место, которое заполняют от руки: номер журнала, число страниц, подписи. */
export const BLANK = '________';

const round = (value: number, digits: number): number => Number(value.toFixed(digits));

/** Отметка острия = отметка головы минус длина сваи. */
function tipLevel(headLevelM: number | null, lengthM: number | null): number | '' {
  return headLevelM === null || lengthM === null ? '' : round(headLevelM - lengthM, 3);
}

/** Номера залогов: «1–12», если идут подряд, иначе перечислением. */
function setNumbers(ordinals: number[]): string {
  if (ordinals.length === 0) return '';
  const consecutive = ordinals.every((ordinal, index) => index === 0 || ordinal === ordinals[index - 1] + 1);
  return consecutive && ordinals.length > 1
    ? `${ordinals[0]}–${ordinals[ordinals.length - 1]}`
    : ordinals.join(', ');
}

function drivingNote(row: PilePassportRow): string {
  const verdict = row.drivingComplete === null
    ? null
    : row.drivingComplete ? 'проектный отказ достигнут' : 'проектный отказ не достигнут';
  return [verdict, row.isDraft ? 'черновик отчёта' : null, row.note].filter(Boolean).join('; ');
}

function pileRow(row: PilePassportRow, timezone: string): XlsxCell[] {
  const blows = [...new Set(row.sets.map((set) => set.blows))].join(', ');
  const depthMm = row.sets.reduce((sum, set) => sum + set.penetrationMm, 0);
  const lastRefusalMm = row.sets.length ? row.sets[row.sets.length - 1].refusalMm : null;
  return [
    printDay(row.drivenAt, timezone),
    row.pileNumber ?? '',
    row.pileNumber ?? '',
    row.pileLengthM,
    row.pileSection ?? '',
    row.pileGradeName,
    '',
    row.designHeadLevelM,
    row.actualHeadLevelM,
    tipLevel(row.designHeadLevelM, row.pileLengthM),
    tipLevel(row.actualHeadLevelM, row.pileLengthM),
    setNumbers(row.sets.map((set) => set.ordinal)),
    blows,
    '',
    '',
    row.dropHeightM,
    '',
    '',
    row.sets.length ? round(depthMm / 10, 1) : '',
    lastRefusalMm === null ? '' : round(lastRefusalMm / 10, 2),
    '',
    drivingNote(row),
  ];
}

const TABLE_HEAD: string[] = [
  'Дата забивки', 'Номер сваи по плану', 'Номер сваи фактически', 'Длина сваи, м',
  'Диаметр или сечение сваи', 'Материал сваи', 'Вес сваи, т',
  'Отметка верха головы по проекту, м', 'Отметка верха головы фактически, м',
  'Отметка низа сваи по проекту, м', 'Отметка низа сваи фактически, м',
  'Номера залогов', 'Число ударов в залоге', 'Частота ударов, в мин', 'Продолжительность работы, мин',
  'Высота подъёма бабы или ход поршня молота, м', 'Погружение сваи от собственного веса, см',
  'Погружение сваи от веса бабы, см', 'Глубина погружения сваи от залогов, см',
  'Отказ при последнем залоге, см', 'Вес ударной части бабы или молота, т', 'Примечание',
];

export interface Form41Input {
  rows: PilePassportRow[];
  header: PileJournalHeader;
  organisation: string;
  truncated: boolean;
  timezone: string;
}

/**
 * Лист формы № 4.1 СП 392.1325800.2018 «Журнал погружения (забивки свай)».
 *
 * ЧТО СЧИТАЕТСЯ САМО. Отметка острия (голова минус длина), глубина погружения от
 * залогов (сумма погружений, см), отказ последнего залога, вердикт по проектному
 * отказу — всё из паспорта и залогов, новых полей не нужно.
 *
 * ЧТО ОСТАЁТСЯ ПУСТЫМ. Вес сваи, частота и продолжительность, погружение от
 * собственного веса и от веса бабы, вес ударной части, наголовник, давление
 * пара: в паспорте сваи этих измерений нет. Графа пустая, а не выдуманная.
 *
 * СВАИ БЕЗ ПАСПОРТА (записаны пачкой) в форму не входят: журнал погружения
 * ведётся по каждой свае, а номера и залогов у пачки нет. Их число печатаем.
 */
export function form41Rows({ rows, header, organisation, truncated, timezone }: Form41Input): XlsxCell[][] {
  const list = (values: (string | number)[]): string => (values.length ? values.join(', ') : BLANK);
  const withPassport = rows.filter((row) => row.hasPassport);
  const skipped = rows.length - withPassport.length;

  return [
    ['Форма № 4.1 СП 392.1325800.2018'],
    [organisation || BLANK, '(наименование строительной организации)'],
    [list(header.siteNames), '(наименование объекта)'],
    [`ЖУРНАЛ № ${BLANK}`],
    ['погружения (забивки свай)'],
    [],
    ['Система копра:', list(header.equipmentNames)],
    ['Тип молота:', list(header.hammerTypes)],
    ['Вес ударной части молота:', BLANK],
    ['Энергия удара молота по паспорту, кДж:', list(header.hammerEnergyKj)],
    ['Характеристика наголовника:', BLANK],
    ['Проектный отказ, см:', list(header.designRefusalMm.map((mm) => round(mm / 10, 2)))],
    ['Давление пара (воздуха) по манометру:', BLANK],
    [],
    TABLE_HEAD,
    TABLE_HEAD.map((_, index) => index + 1),
    ...withPassport.map((row) => pileRow(row, timezone)),
    [],
    ...(skipped > 0 ? [[`Свай без паспорта в форму не включено: ${skipped} (записаны пачкой, номеров и залогов нет)`]] : []),
    ...(truncated ? [[`Показаны первые ${PILE_JOURNAL_EXPORT_LIMIT} записей — сузьте период или объект`]] : []),
    [`В журнале пронумеровано и прошнуровано ${BLANK} страниц.`],
    [`Журнал начат «${header.dateFrom ?? BLANK}»`],
    [`Журнал окончен «${header.dateTo ?? BLANK}»`],
    ['Должность, Ф. И. О. и подпись руководителя организации, выдавшего журнал:', BLANK],
    ['М.П.'],
  ];
}

/** Форма № 4.1 в .xlsx по тем же фильтрам, что и обычная выгрузка журнала. */
export async function exportPileJournalForm41Xlsx(filters: PileJournalFilters): Promise<Buffer> {
  const { buildXlsx } = await import('@/lib/xlsx-writer');
  const { timezone, companyName } = await getSettings(filters.tenantId);
  const { rows, truncated, totals } = await listPilePassports({
    ...filters,
    limit: PILE_JOURNAL_EXPORT_LIMIT,
    timezone,
  });
  return buildXlsx([
    {
      name: 'Форма 4.1',
      rows: form41Rows({
        rows,
        header: pileJournalHeader(rows, totals, timezone),
        organisation: companyName ?? '',
        truncated,
        timezone,
      }),
    },
  ]);
}
