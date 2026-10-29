import { getSettings } from '@/modules/settings';
import type { XlsxCell } from '@/lib/xlsx-writer';
import { PILE_JOURNAL_EXPORT_LIMIT, type PileJournalFilters, type PileJournalHeader, type PilePassportRow } from './pile-journal-types';
import { listPilePassports } from './pile-journal-list';
import { pileJournalHeader } from './pile-journal-totals';
import { BLANK } from './pile-journal-form41';

/** Сколько номеров свай печатаем в акте; остальные — в журнале. */
const NUMBERS_LIMIT = 50;

export interface AosrInput {
  rows: PilePassportRow[];
  header: PileJournalHeader;
  organisation: string;
  inn: string;
  truncated?: boolean;
}

export const SIGNERS = [
  'Представитель застройщика, технического заказчика, лица, ответственного за эксплуатацию здания, сооружения, или регионального оператора по вопросам строительного контроля',
  'Представитель лица, осуществляющего строительство, реконструкцию, капитальный ремонт',
  'Представитель лица, осуществляющего строительство, реконструкцию, капитальный ремонт, по вопросам строительного контроля',
  'Представитель лица, осуществляющего подготовку проектной документации (в случае привлечения для проверки соответствия работ проектной документации)',
  'Представитель лица, выполнившего работы, подлежащие освидетельствованию (в случае выполнения работ по договору с иным лицом)',
];

/** Шапка акта скрытых работ (приложение № 3 к 344/пр) до пункта 1. */
export function actHead(site: string, organisation: string, inn: string): XlsxCell[][] {
  const builder = [organisation || BLANK, inn ? `ИНН ${inn}` : null].filter(Boolean).join(', ');
  return [
    ['Приложение № 3 к составу исполнительной документации (приказ Минстроя России от 16.05.2023 № 344/пр)'],
    ['Объект капитального строительства', site],
    ['Застройщик, технический заказчик, лицо, ответственное за эксплуатацию здания, сооружения, или региональный оператор', BLANK],
    ['Лицо, осуществляющее строительство, реконструкцию, капитальный ремонт', builder],
    ['Лицо, осуществляющее подготовку проектной документации', BLANK],
    [],
    ['АКТ освидетельствования скрытых работ'],
    [`№ ${BLANK}`, `«__» ____________ 20__ г.`, '(дата составления акта)'],
    [],
    ...SIGNERS.flatMap((title) => [[title], [BLANK]]),
    ['произвели осмотр работ, выполненных', organisation || BLANK],
    ['и составили настоящий акт о нижеследующем:'],
    [],
  ];
}

/** Концовка акта: предупреждение о срезе и блоки подписей. */
export function actTail(truncated: boolean | undefined): XlsxCell[][] {
  return [
    ...(truncated ? [[`Показаны первые ${PILE_JOURNAL_EXPORT_LIMIT} записей — сузьте период или объект`]] : []),
    ...SIGNERS.flatMap((title) => [[title], [BLANK], ['(фамилия, инициалы)', '(подпись)']]),
  ];
}

/** Сваи одной марки, сечения и длины — одной строкой «… — N шт.». */
export function pileGroups(piles: PilePassportRow[]): string[] {
  const groups = new Map<string, number>();
  for (const pile of piles) {
    const key = [pile.pileGradeName, pile.pileSection, pile.pileLengthM === null ? null : `длина ${pile.pileLengthM} м`]
      .filter(Boolean).join(', ');
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return [...groups].map(([key, count]) => `${key} — ${count} шт.`);
}

/**
 * Акт освидетельствования скрытых работ на погружение свай — приложение № 3 к
 * приказу Минстроя России от 16.05.2023 № 344/пр (рекомендуемый образец).
 *
 * В АКТ ИДУТ ТОЛЬКО ПРИНЯТЫЕ СВАИ. Освидетельствуют то, что мастер принял; сваи
 * «не разобрана» и «на добивку» актом закрывать нельзя, их число печатаем.
 *
 * ЧТО ПУСТО. Реквизиты заказчика и проектировщика, шифр проекта, сертификаты
 * завода, решение о последующих работах и подписанты: справочника участников в
 * приложении нет, это заполняют в файле от руки.
 */
export function aosrRows({ rows, header, organisation, inn, truncated }: AosrInput): XlsxCell[][] {
  const accepted = rows.filter((row) => row.hasPassport && row.acceptance === 'ACCEPTED');
  const notAccepted = rows.filter((row) => row.hasPassport && row.acceptance !== 'ACCEPTED').length;
  const numbers = accepted.map((row) => row.pileNumber).filter((n): n is string => n !== null);
  const shown = numbers.slice(0, NUMBERS_LIMIT).join(', ');
  const rest = numbers.length - NUMBERS_LIMIT;
  const site = header.siteNames.join(', ') || BLANK;

  return [
    ...actHead(site, organisation, inn),
    ['1. К освидетельствованию предъявлены следующие работы', 'Погружение свай'],
    ...pileGroups(accepted).map((line) => ['', line]),
    ['', `Итого принятых свай: ${accepted.length} шт.`],
    ['', `Копёр: ${header.equipmentNames.join(', ') || BLANK}; молот: ${header.hammerTypes.join(', ') || BLANK}`],
    ['', `Номера свай: ${shown || BLANK}${rest > 0 ? ` и ещё ${rest} (полный перечень — в журнале погружения)` : ''}`],
    ...(notAccepted > 0 ? [['', `Свай с решением «не разобрана» или «на добивку» в акт не включено: ${notAccepted}`]] : []),
    ['2. Работы выполнены по проектной документации', BLANK, '(номер, реквизиты чертежей, наименование проектной и (или) рабочей документации)'],
    ['3. При выполнении работ применены', pileGroups(accepted).join('; ') || BLANK, '(реквизиты сертификатов и паспортов завода-изготовителя)', BLANK],
    ['4. Предъявлены документы, подтверждающие соответствие работ предъявляемым к ним требованиям, в том числе:'],
    ['', `а) журнал погружения (забивки) свай, форма № 4.1 СП 392.1325800.2018, № ${BLANK}`],
    ['', 'б) сводная ведомость забитых свай (форма № 2.5 ВСН 012-88)'],
    ['', `в) исполнительная схема планового и высотного положения голов свай: ${BLANK}`],
    ['5. Даты', `начала работ: ${header.dateFrom ?? BLANK}`, `окончания работ: ${header.dateTo ?? BLANK}`],
    ['6. Работы выполнены в соответствии с техническими регламентами, иными нормативными правовыми актами и проектной документацией', BLANK],
    ['7. На основании изложенного разрешается производство последующих работ', BLANK, '(наименование работ, конструкций, участков сетей)'],
    ['Дополнительные сведения', BLANK],
    ['Акт составлен в', BLANK, 'экземплярах'],
    ['Приложения', BLANK, '(исполнительные схемы и чертежи, результаты испытаний)'],
    [],
    ...actTail(truncated),
  ];
}

/** АОСР на погружение свай в .xlsx по тем же фильтрам, что и журнал. */
export async function exportPileAosrXlsx(filters: PileJournalFilters): Promise<Buffer> {
  const { buildXlsx } = await import('@/lib/xlsx-writer');
  const { timezone, companyName, inn } = await getSettings(filters.tenantId);
  const { rows, truncated, totals } = await listPilePassports({
    ...filters,
    limit: PILE_JOURNAL_EXPORT_LIMIT,
    timezone,
  });
  return buildXlsx([
    {
      name: 'АОСР погружение свай',
      rows: aosrRows({
        rows,
        header: pileJournalHeader(rows, totals, timezone),
        organisation: companyName ?? '',
        inn: inn ?? '',
        truncated,
      }),
    },
  ]);
}
