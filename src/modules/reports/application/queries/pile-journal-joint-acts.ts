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
import { BLANK } from './pile-journal-form41';
import { actHead, actTail } from './pile-journal-aosr';
import { printDay } from './pile-journal-export';

/** Сколько стыков печатаем в акте; остальные — в журнале. */
const JOINTS_LIMIT = 100;

export type JointActKind = 'WELD' | 'ANTICORROSION';

export interface JointActInput {
  kind: JointActKind;
  rows: PilePassportRow[];
  header: PileJournalHeader;
  organisation: string;
  inn: string;
  timezone: string;
  truncated?: boolean;
}

const WORK_NAME: Record<JointActKind, string> = {
  WELD: 'Сварка стыков секций составных свай',
  ANTICORROSION: 'Антикоррозионная обработка сварных стыков секций составных свай',
};

/** Момент времени — ДД.ММ.ГГГГ ЧЧ:ММ в поясе организации. */
function moment(iso: string, timezone: string): string {
  const time = new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: timezone });
  return `${printDay(iso, timezone)} ${time}`;
}

/**
 * Акт скрытых работ по стыкам составных свай — приложение № 3 к приказу
 * Минстроя России от 16.05.2023 № 344/пр. Документ 5 списка СП 48.13330 (Б.3) —
 * сварка секций, документ 6 — антикоррозионная обработка стыков.
 *
 * В акт идут только принятые сваи со стыками. В акте на антикоррозию — только
 * стыки с нанесённым покрытием; сколько стыков остались без него, печатаем:
 * такой стык актом закрывать нельзя.
 *
 * Данные сварки (сварщик, электроды, покрытие) вносит оператор вместе с паспортом
 * сваи. Удостоверение сварщика, результат контроля шва, заказчик, проектировщик и
 * подписанты остаются для ручного заполнения.
 */
export function jointActRows({ kind, rows, header, organisation, inn, timezone, truncated }: JointActInput): XlsxCell[][] {
  const withJoints = rows.filter((row) => row.hasPassport && row.joints.length > 0);
  const accepted = withJoints.filter((row) => row.acceptance === 'ACCEPTED');
  const notAccepted = withJoints.length - accepted.length;

  const lines: string[] = [];
  const stamps: string[] = [];
  const materials = new Set<string>();
  let withoutCoating = 0;
  let total = 0;
  for (const pile of accepted) {
    for (const joint of pile.joints) {
      if (kind === 'ANTICORROSION' && !joint.anticorrosionAt) {
        withoutCoating += 1;
        continue;
      }
      total += 1;
      const at = kind === 'WELD' ? joint.weldedAt : joint.anticorrosionAt as string;
      stamps.push(at);
      const what = kind === 'WELD'
        ? `сварщик ${joint.welderName}, электроды ${joint.electrode}`
        : `покрытие ${joint.anticorrosionMaterial}`;
      if (kind === 'WELD') materials.add(joint.electrode);
      else if (joint.anticorrosionMaterial) materials.add(joint.anticorrosionMaterial);
      lines.push(`${pile.pileNumber ?? BLANK}, стык ${joint.ordinal} — ${moment(at, timezone)}, ${what}`);
    }
  }
  stamps.sort();
  const shown = lines.slice(0, JOINTS_LIMIT);
  const rest = lines.length - shown.length;
  const first = stamps[0] ? printDay(stamps[0], timezone) : BLANK;
  const last = stamps.length ? printDay(stamps[stamps.length - 1], timezone) : BLANK;

  return [
    ...actHead(header.siteNames.join(', ') || BLANK, organisation, inn),
    ['1. К освидетельствованию предъявлены следующие работы', WORK_NAME[kind]],
    ...(total === 0 ? [['', 'Составных свай со стыками в выборке нет']] : []),
    ...shown.map((line) => ['', line]),
    ...(rest > 0 ? [['', `и ещё ${rest} (полный перечень — в журнале)`]] : []),
    ['', `Итого стыков: ${total} шт.`],
    ...(withoutCoating > 0 ? [['', `Стыков, где обработка не выполнена: ${withoutCoating} — в акт не включены`]] : []),
    ...(notAccepted > 0 ? [['', `Составных свай с решением «не разобрана» или «на добивку» в акт не включено: ${notAccepted}`]] : []),
    ['2. Работы выполнены по проектной документации', BLANK, '(номер, реквизиты чертежей, наименование проектной и (или) рабочей документации)'],
    ['3. При выполнении работ применены', [...materials].join(', ') || BLANK, kind === 'WELD'
      ? '(сертификаты на электроды, удостоверения сварщиков)'
      : '(сертификаты на материал покрытия)', BLANK],
    ['4. Предъявлены документы, подтверждающие соответствие работ предъявляемым к ним требованиям, в том числе:'],
    ['', `а) журнал погружения (забивки) свай, форма № 4.1 СП 392.1325800.2018, № ${BLANK}`],
    ['', `б) ${kind === 'WELD' ? 'журнал сварочных работ, результаты контроля сварных швов' : 'акт на сварку секций'}: ${BLANK}`],
    ['5. Даты', `начала работ: ${first}`, `окончания работ: ${last}`],
    ['6. Работы выполнены в соответствии с техническими регламентами, иными нормативными правовыми актами и проектной документацией', BLANK],
    ['7. На основании изложенного разрешается производство последующих работ', BLANK, '(наименование работ, конструкций, участков сетей)'],
    ['Дополнительные сведения', BLANK],
    ['Акт составлен в', BLANK, 'экземплярах'],
    ['Приложения', BLANK, '(исполнительные схемы и чертежи, результаты испытаний)'],
    [],
    ...actTail(truncated),
  ];
}

/** Акт по стыкам в .xlsx по тем же фильтрам, что и журнал. */
export async function exportPileJointActXlsx(filters: PileJournalFilters, kind: JointActKind): Promise<Buffer> {
  const { buildXlsx } = await import('@/lib/xlsx-writer');
  const { timezone, companyName, inn } = await getSettings(filters.tenantId);
  const { rows, truncated, totals } = await listPilePassports({
    ...filters,
    limit: PILE_JOURNAL_EXPORT_LIMIT,
    timezone,
  });
  return buildXlsx([
    {
      name: kind === 'WELD' ? 'АОСР сварка секций' : 'АОСР антикоррозия',
      rows: jointActRows({
        kind,
        rows,
        header: pileJournalHeader(rows, totals, timezone),
        organisation: companyName ?? '',
        inn: inn ?? '',
        timezone,
        truncated,
      }),
    },
  ]);
}
