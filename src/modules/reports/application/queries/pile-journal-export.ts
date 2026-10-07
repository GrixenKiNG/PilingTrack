import { getSettings } from '@/modules/settings';
import {
  PILE_JOURNAL_EXPORT_LIMIT,
  type PileAcceptanceValue,
  type PileJournalFilters,
  type PilePassportRow,
} from './pile-journal-types';
import { listPilePassports } from './pile-journal-list';
import { pileJournalHeader } from './pile-journal-totals';

/** День журнала в печатном виде — ДД.ММ.ГГГГ, как требует PRODUCT.md. */
function printDay(iso: string, timezone: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: timezone,
  });
}

/** Момент времени в печатном виде — ДД.ММ.ГГГГ ЧЧ:ММ в поясе тенанта. */
function printMoment(date: Date, timezone: string): string {
  const time = date.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  });
  return `${printDay(date.toISOString(), timezone)} ${time}`;
}

const ACCEPTANCE_TEXT: Record<PileAcceptanceValue, string> = {
  PENDING: 'Не разобрана',
  ACCEPTED: 'Принята',
  NEEDS_REDRIVE: 'На добивку',
};

/** Смена в печатном виде. Пустое/чужое значение печатаем как есть, не выдаём за дневную. */
const SHIFT_TEXT: Record<string, string> = {
  DAY: 'Дневная',
  NIGHT: 'Ночная',
};

function shiftText(shiftType: string | null): string {
  if (!shiftType) return '';
  return SHIFT_TEXT[shiftType] ?? shiftType;
}

/**
 * Журнал забивки в .xlsx — тот лист, который распечатывают и подшивают.
 *
 * ПОЧЕМУ ДВА ЛИСТА. Нормативная форма и есть два листа: титул (копёр, молот,
 * энергия удара, проектные величины, период) и строки по сваям. Свалить титул
 * в шапку таблицы значило бы повторять его в каждой строке.
 *
 * ПОЧЕМУ ЗАЛОГИ ОТДЕЛЬНЫМ ЛИСТОМ. «Погружение сваи от каждого залога» —
 * обязательная графа, и у одной сваи залогов десяток. В строке сваи они
 * помещаются только текстом, который в Excel нечем считать.
 */
export async function exportPileJournalXlsx(filters: PileJournalFilters): Promise<Buffer> {
  const { buildXlsx } = await import('@/lib/xlsx-writer');
  // День документа — день тенанта, а не UTC (F-R17-1): свая, забитая в 00:30
  // МСК, в UTC ещё вчерашняя, и подшитый журнал датировал бы её соседним днём.
  const { timezone, companyName, inn } = await getSettings(filters.tenantId);
  // Выгрузка — нормативный документ: у неё свой, высокий предел строк, а не
  // экранные 500. Титул при этом считается по всему периоду (агрегат), поэтому
  // и при срезе счётчики честные.
  const { rows, truncated, totals } = await listPilePassports({
    ...filters,
    limit: PILE_JOURNAL_EXPORT_LIMIT,
    timezone,
  });
  const header = pileJournalHeader(rows, totals, timezone);

  const list = (values: (string | number)[]): string => (values.length ? values.join(', ') : '—');

  // Исполнителя работ печатает нормативный журнал (СП 45.13330): подшитый
  // документ без организации не привязать к подрядчику. Пустые части не
  // печатаем — строка «Организация: , ИНН» хуже отсутствия строки.
  const organisation = [
    companyName ? `Организация: ${companyName}` : null,
    inn ? `ИНН ${inn}` : null,
  ].filter((part): part is string => part !== null).join(', ');

  const title: (string | number | null)[][] = [
    ['ЖУРНАЛ ЗАБИВКИ СВАЙ'],
    ...(organisation ? [[organisation]] : []),
    ['Объект', list(header.siteNames)],
    ['Копровая установка', list(header.equipmentNames)],
    ['Молот', list(header.hammerTypes)],
    ['Энергия удара, кДж', list(header.hammerEnergyKj)],
    ['Проектный отказ, мм/удар', list(header.designRefusalMm)],
    ['Период забивки', `${header.dateFrom ?? '—'} — ${header.dateTo ?? '—'}`],
    [],
    ['Свай (всего)', header.pilesTotal],
    ['из них в черновиках', header.draftPiles],
    ['Свай без паспорта', header.withoutPassportPiles],
    ['Паспортов принято', header.accepted],
    ['Паспортов на добивку', header.needsRedrive],
    ['Паспортов не разобрано', header.pending],
    [],
    ['Отказ считается как среднее по трём последним залогам (СП 45.13330).'],
    // Дата формирования — по поясу тенанта, как и весь остальной документ (F-R37-1):
    // журнал, выгруженный 26.09 в 01:00 МСК, не должен датироваться 25.09 по UTC.
    ['Журнал выгружен', printMoment(new Date(), timezone)],
    // Не молчим о срезе: иначе подшитый документ выглядел бы как полный.
    ...(truncated ? [[`Показаны первые ${PILE_JOURNAL_EXPORT_LIMIT} записей — сузьте период или объект`]] : []),
  ];

  const piles: (string | number | null)[][] = [[
    '№ п/п', 'Дата забивки', 'Смена', '№ сваи по проекту', 'Куст, пикет', 'Марка сваи', 'Сечение',
    'Длина, м', 'Отметка головы проектная, м', 'Отметка головы фактическая, м',
    'Глубина погружения, м', 'Залогов', 'Ударов всего', 'Ударов на последний метр',
    'Отказ проектный, мм/уд', 'Отказ фактический, мм/уд', 'Забита по норме',
    'Отклонение в плане, мм', 'Отклонение от вертикали, %',
    'Молот', 'Энергия удара, кДж', 'Высота подъёма, м',
    'Добивка', 'Добойник', 'Голова срублена',
    'Машинист', 'Установка', 'Решение', 'Принял', 'Дата решения', 'Основание решения', 'Примечание',
    'Количество, шт', 'Пометка',
  ]];

  const setsSheet: (string | number | null)[][] = [[
    '№ сваи по проекту', 'Дата забивки', '№ залога', 'Ударов в залоге',
    'Погружение за залог, мм', 'Высота подъёма бойка, м', 'Отказ за залог, мм/уд',
  ]];

  const yesNo = (value: boolean): string => (value ? 'да' : 'нет');

  // Та же пометка, что и на экране: свая без паспорта и черновик отчёта.
  // Подшитый документ не должен выглядеть полнее экрана, на котором его собрали.
  const marks = (row: PilePassportRow): string => [
    row.hasPassport ? null : 'без паспорта',
    row.isDraft ? 'черновик' : null,
  ].filter((part): part is string => part !== null).join(', ');

  rows.forEach((row, index) => {
    piles.push([
      index + 1,
      printDay(row.drivenAt, timezone),
      shiftText(row.shiftType),
      row.pileNumber ?? '',
      row.locationName ?? '',
      row.pileGradeName,
      row.pileSection ?? '',
      row.pileLengthM,
      row.designHeadLevelM,
      row.actualHeadLevelM,
      row.drivenDepthM,
      row.sets.length || null,
      row.totalBlows,
      row.blowsLastMeter,
      row.designRefusalMm,
      row.refusalMm,
      row.drivingComplete === null ? '—' : yesNo(row.drivingComplete),
      row.planDeviationMm,
      row.tiltPercent,
      row.hammerType ?? '',
      row.hammerEnergyKj,
      row.dropHeightM,
      yesNo(row.redriven),
      yesNo(row.followerUsed),
      yesNo(row.headCutOff),
      row.operatorName,
      row.equipmentName ?? '',
      row.acceptance ? ACCEPTANCE_TEXT[row.acceptance] : '',
      row.acceptedByName ?? '',
      row.acceptedAt ? printDay(row.acceptedAt, timezone) : '',
      row.acceptanceNote ?? '',
      row.note ?? '',
      row.count,
      marks(row),
    ]);

    for (const set of row.sets) {
      setsSheet.push([
        row.pileNumber ?? '',
        printDay(row.drivenAt, timezone),
        set.ordinal,
        set.blows,
        set.penetrationMm,
        set.dropHeightM,
        set.refusalMm,
      ]);
    }
  });

  // Дата составления и подписи — обязательные реквизиты нормативного журнала
  // (СП 45.13330): без них распечатку не подписать и не подшить.
  piles.push([]);
  piles.push([`Дата составления: ${printDay(new Date().toISOString(), timezone)}`]);
  piles.push(['Производитель работ ____________ / ФИО /']);
  piles.push(['Представитель технического надзора ____________ / ФИО /']);

  return buildXlsx([
    { name: 'Титул', rows: title },
    { name: 'Журнал забивки', rows: piles },
    { name: 'Залоги', rows: setsSheet },
  ]);
}
