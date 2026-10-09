import { isSubmittedReport } from '@/lib/report-status';
/**
 * Report Export Service — выгрузки отчётов (CSV и Excel).
 *
 * Модуль выделен из report-query.service.ts без изменения поведения
 * (решение владельца 26.09.2026: файлы больше ~500 строк делить по
 * назначению). Читающие запросы остались в `./report-query.service`,
 * который реэкспортирует публичные функции отсюда — путь импорта для
 * вызывающих не менялся.
 */

import { db } from '@/lib/db';
import { ServiceError } from '@/lib/service-error';
import { pileLengthMeters } from '@/lib/pile-length';
import { formatRuDate } from '@/lib/format';
import { getSettings } from '@/modules/settings';

/**
 * Ячейка CSV: экранирование кавычек плюс защита от подстановки формул.
 *
 * Excel и LibreOffice считают формулой любую ячейку, начинающуюся с `=`, `+`,
 * `-` или `@`, и кавычки от этого не спасают — они всего лишь разделители
 * полей, интерпретатор их снимает. Комментарий к простою пишет оператор в
 * свободной форме, а выгрузку открывает администратор: строка вида
 * `=HYPERLINK("http://…"&A1)` превращается в утечку данных одним кликом,
 * а `=cmd|…` на старых сборках Excel — в запуск команды (CWE-1236).
 *
 * Обезвреживаем апострофом впереди: Excel показывает исходный текст и не
 * вычисляет его, апостроф в ячейке не виден. Табуляция и перевод строки в
 * начале тоже считаются началом формулы после того, как парсер их отбросит, —
 * поэтому смотрим на первый непробельный символ.
 *
 * Обычные числа при этом не трогаем. Иначе `-5` уехало бы в файл текстом, и
 * колонка перестала бы суммироваться — защита сломала бы саму выгрузку. А вот
 * `-5+A1` числом не является и апостроф получит.
 */
const PLAIN_NUMBER = /^-?\d+([.,]\d+)?$/;
const FORMULA_START = new Set(['=', '+', '-', '@']);

function csvCell(value: string): string {
  const escaped = value.replace(/"/g, '""');
  const trimmed = escaped.trimStart();
  if (PLAIN_NUMBER.test(trimmed)) return `"${escaped}"`;
  return FORMULA_START.has(trimmed.charAt(0)) ? `"'${escaped}"` : `"${escaped}"`;
}

/** Метраж сваи неизвестен: у марки не задана длина (PileGrade.lengthMm = null). */
const PILE_LENGTH_UNKNOWN_LABEL = 'длина марки не задана';
/** Пометка к итогу м.п., когда хотя бы у одной марки не задана длина. */
const PILE_METERS_INCOMPLETE_NOTE = '(неполный: у марки не задана длина)';

/**
 * Смена в печатном виде. Одно правило на CSV и XLSX (находка 19): раньше
 * `=== 'NIGHT' ? … : 'Дневная'` печатало любое чужое значение как «Дневная»,
 * то есть выгрузка молча подменяла смену, если в базе окажется что-то кроме
 * DAY/NIGHT. Пустое значение — пустая ячейка, чужое — как есть.
 */
const SHIFT_TEXT: Record<string, string> = {
  DAY: 'Дневная',
  NIGHT: 'Ночная',
};

function shiftLabel(shiftType: string | null | undefined): string {
  if (!shiftType) return '';
  return SHIFT_TEXT[shiftType] ?? shiftType;
}

/**
 * Погонные метры в CSV: доли — через запятую (находка 13). Русский Excel с
 * разделителем «;» читает «37.5» как текст и колонку не суммирует.
 * `formatFixed` из @/lib/format сюда не подходит: он добавляет ещё и разряды
 * неразрывным пробелом («1 200,0»), а это для Excel снова текст.
 */
function csvMeters(meters: number): string {
  return meters.toFixed(1).replace('.', ',');
}

/**
 * Дробное значение в CSV — через запятую, разделитель полей «;» (D-20260930-007).
 * Метры бурения и часы простоя уходили точкой («16.7»), и русский Excel читал
 * их как текст: колонка не суммировалась. Целые оставляем как есть — «2», а не
 * «2,0». `formatFixed` из @/lib/format сюда не подходит по той же причине, что и
 * в csvMeters: он добавляет разряды неразрывным пробелом («1 234,5»).
 */
function csvDecimal(value: number): string {
  return String(value).replace('.', ',');
}

/** Метраж по строке свай: count × длина сваи из единственного источника (lib/pile-length). */
function pileRowMeters(pile: { count?: number | null; pileGrade?: { lengthMm?: number | null } | null }): number {
  return (pile.count ?? 0) * pileLengthMeters({ gradeLengthMm: pile.pileGrade?.lengthMm });
}

/**
 * Сданность отчёта в выгрузке (решение владельца 26.09.2026): несданная смена
 * в файле остаётся, но подписана — иначе строка черновика попадает в подшитый
 * документ как обычная сдача и расходится с аналитикой, которая черновики не
 * считает. Состав строк выгрузки при этом не меняется.
 */
function reportStatusExportLabel(status: string | null | undefined): string {
  if (status === 'submitted') return 'сдан';
  if (status === 'draft') return 'черновик (смена не сдана)';
  return status ?? '';
}

export interface ReportExportFilters {
  tenantId: string;
  userId?: string | null;
  equipmentId?: string | null;
  filter?: 'downtime' | 'withPhotos' | 'edited' | null;
  siteId?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
}

/**
 * \u041E\u0434\u0438\u043D \u0437\u0430\u043F\u0440\u043E\u0441 \u043F\u043E\u0434 \u043E\u0431\u0435 \u0432\u044B\u0433\u0440\u0443\u0437\u043A\u0438 (CSV \u0438 Excel), \u0447\u0442\u043E\u0431\u044B \u0441\u043E\u0441\u0442\u0430\u0432 \u043A\u043E\u043B\u043E\u043D\u043E\u043A \u0438 \u0444\u0438\u043B\u044C\u0442\u0440 \u043D\u0435
 * \u0440\u0430\u0437\u044A\u0435\u0437\u0436\u0430\u043B\u0438\u0441\u044C \u043C\u0435\u0436\u0434\u0443 \u0444\u043E\u0440\u043C\u0430\u0442\u0430\u043C\u0438. \u0422\u0435\u043D\u0430\u043D\u0442 \u2014 \u0441\u0442\u0440\u043E\u0433\u0438\u043C \u0440\u0430\u0432\u0435\u043D\u0441\u0442\u0432\u043E\u043C (IDOR guard).
 */
async function fetchReportsForExport(filters: ReportExportFilters) {
  if (!filters.tenantId) {
    throw new ServiceError('tenantId is required', 400); // fail-closed (IDOR guard)
  }

  const where: Record<string, unknown> = { tenantId: filters.tenantId };
  if (filters.siteId) where.siteId = filters.siteId;
  if (filters.userId) where.userId = filters.userId;
  if (filters.equipmentId) where.equipmentId = filters.equipmentId;
  if (filters.dateFrom || filters.dateTo) {
    where.date = {};
    if (filters.dateFrom) (where.date as Record<string, unknown>).gte = filters.dateFrom;
    if (filters.dateTo) (where.date as Record<string, unknown>).lte = filters.dateTo;
  }

  const reports = await db.report.findMany({
    where,
    include: {
      user: { select: { name: true } },
      equipment: { select: { name: true } },
      crew: { select: { name: true, equipment: { select: { name: true } } } },
      site: { select: { name: true } },
      piles: { include: { pileGrade: true } },
      drillings: { include: { type: true } },
      downtimes: { include: { reason: true } },
    },
    orderBy: { date: 'desc' },
  });
  if (filters.filter === 'downtime') return reports.filter((report) => report.downtimes.reduce((sum, row) => sum + row.duration, 0) > 0);
  if (filters.filter === 'edited') return reports.filter((report) => Boolean(report.lastEditedByName));
  if (filters.filter === 'withPhotos') {
    const media = await db.media.findMany({
      where: { tenantId: filters.tenantId, entityType: 'report', entityId: { in: reports.map(row => row.reportId) }, isDeleted: false, uploadStatus: 'completed' },
      select: { entityId: true },
    });
    const withPhotos = new Set(media.map(row => row.entityId));
    return reports.filter(report => withPhotos.has(report.reportId));
  }
  return reports;

}

export async function exportReportsCsv(filters: ReportExportFilters) {
  const reports = await fetchReportsForExport(filters);

  const BOM = '\uFEFF';
  const header =
    'ID отчёта;Дата;Смена;Статус;Объект;Оператор;Экипаж;Установка;Моточасы на конец, м/ч;Остаток топлива, %;Марка сваи;Кол-во свай;Свай, м.п.;Тип бурения;Метры бурения;Причина простоя;Часы простоя;Комментарий';

  const rows = reports.flatMap((report) => {
    const base = {
      reportId: report.reportId,
      // Выгрузку открывает человек: дата — ДД.ММ.ГГГГ, а не ISO-строка из БД.
      date: formatRuDate(report.date),
      shift: shiftLabel(report.shiftType),
      status: reportStatusExportLabel(report.status),
      site: report.site.name,
      operator: report.user.name,
      crew: report.crew?.name || '',
      equipment: report.equipment?.name || report.crew?.equipment?.name || '',
      endingEngineHours: report.endingEngineHours == null ? '' : csvDecimal(report.endingEngineHours),
      endingFuelPercent: report.endingFuelPercent == null ? '' : csvDecimal(report.endingFuelPercent),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped external/library boundary
    const pileRows = report.piles.map((pile: any) => {
      const meters = pileRowMeters(pile);
      return {
        ...base,
        pileGrade: pile.pileGrade?.name ?? '',
        pileCount: String(pile.count),
        // Без длины марки метраж не считается: печатаем пояснение, а не «0.0» —
        // иначе пустая длина выглядит как реальный ноль погонных метров.
        pileMeters: meters > 0 ? csvMeters(meters) : PILE_LENGTH_UNKNOWN_LABEL,
        drillType: '',
        drillMeters: '',
        dtReason: '',
        dtHours: '',
        dtComment: '',
      };
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped external/library boundary
    const drillingRows = report.drillings.map((drilling: any) => ({
      ...base,
      pileGrade: '',
      pileCount: '',
      pileMeters: '',
      drillType: drilling.type?.name ?? '',
      drillMeters: csvDecimal(drilling.meters),
      dtReason: '',
      dtHours: '',
      dtComment: '',
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped external/library boundary
    const downtimeRows = report.downtimes.map((downtime: any) => ({
      ...base,
      pileGrade: '',
      pileCount: '',
      pileMeters: '',
      drillType: '',
      drillMeters: '',
      dtReason: downtime.reason?.name ?? '',
      dtHours: csvDecimal(downtime.duration),
      dtComment: downtime.comment || '',
    }));

    if (pileRows.length === 0 && drillingRows.length === 0 && downtimeRows.length === 0) {
      return [
        {
          ...base,
          pileGrade: '',
          pileCount: '',
          pileMeters: '',
          drillType: '',
          drillMeters: '',
          dtReason: '',
          dtHours: '',
          dtComment: '',
        },
      ];
    }

    return [...pileRows, ...drillingRows, ...downtimeRows];
  });

  const csvLines = rows.map((row: Record<string, string>) =>
    Object.values(row).map(csvCell).join(';')
  );

  return BOM + header + '\n' + csvLines.join('\n');
}

/** ГГГГ-ММ-ДД → ДД.ММ.ГГГГ. */
function printYmd(ymd: string): string {
  const [year, month, day] = ymd.split('-');
  return `${day}.${month}.${year}`;
}

/** День журнала в печатном виде — ДД.ММ.ГГГГ по поясу тенанта. */
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

/**
 * Та же выгрузка отчётов, но настоящим .xlsx. В отличие от CSV числа лежат
 * числами (Excel их суммирует без «преобразования текста»), а итоги вынесены
 * на отдельный лист. Два листа: «Детализация» (строка на каждую сваю / бурение
 * / простой) и «Итоги» (одна строка на отчёт).
 */
export async function exportReportsXlsx(filters: ReportExportFilters): Promise<Buffer> {
  const { buildXlsx } = await import('@/lib/xlsx-writer');
  const reports = await fetchReportsForExport(filters);
  // Пояс и реквизиты тенанта — те же, что печатает журнал забивки (F-R17-1):
  // отметка «Выгружено» обязана стоять по поясу организации, а не сервера.
  const { timezone, companyName, inn } = await getSettings(filters.tenantId);

  // Смена — единым правилом (находка 19), см. shiftLabel. Незнакомое значение
  // печатаем как есть, а не выдаём за дневную.

  // Реквизиты выгрузки — над таблицей (F-R44-9). Файл уходит в переписку или
  // подшивается, и по нему должно быть видно, чья это организация, за какой
  // период и когда выгружен: иначе проверить его вне интерфейса нечем. Те же
  // три факта журнал забивки печатает на титуле. Пустые части организации не
  // печатаем — строка «Организация: , ИНН» хуже её отсутствия.
  const organisation = [
    companyName ? `Организация: ${companyName}` : null,
    inn ? `ИНН ${inn}` : null,
  ].filter((part): part is string => part !== null).join(', ');
  const requisites: (string | number | null)[][] = [
    ...(organisation ? [[organisation]] : []),
    [`Период: ${filters.dateFrom ? printYmd(filters.dateFrom) : '—'} — ${filters.dateTo ? printYmd(filters.dateTo) : '—'}`],
    [`Выгружено: ${printMoment(new Date(), timezone)}`],
    [],
  ];

  // --- Лист 1: детализация (числа — числами). ---
  const detail: (string | number | null)[][] = [
    ...requisites,
    [
      'ID отчёта', 'Дата', 'Смена', 'Статус', 'Объект', 'Оператор', 'Экипаж', 'Установка',
      'Марка сваи', 'Кол-во свай', 'Свай, м.п.', 'Тип бурения', 'Метры бурения', 'Причина простоя', 'Часы простоя', 'Комментарий',
      'Примечание',
    ],
  ];
  for (const r of reports) {
    const base = [
      r.reportId, formatRuDate(r.date), shiftLabel(r.shiftType), reportStatusExportLabel(r.status), r.site.name, r.user.name,
      r.crew?.name || '', r.equipment?.name || r.crew?.equipment?.name || '',
    ];
    // Справочники (марка/тип/причина) — через `?.`: у старых строк ссылка на
    // словарь может не разрешиться (дрейф после переноса базы), и без защиты
    // весь экспорт падает из-за одной такой строки.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped external/library boundary
    for (const p of r.piles as any[]) {
      const meters = pileRowMeters(p);
      // Колонка «Свай, м.п.» — числовая: без длины марки её оставляем пустой,
      // а пояснение печатаем в «Примечании» (находка 14) — иначе текст в
      // числовой колонке делает её текстовой и лист не суммируется.
      detail.push([...base, p.pileGrade?.name ?? '', p.count, meters > 0 ? meters : null, '', null, '', null, '', meters > 0 ? '' : PILE_LENGTH_UNKNOWN_LABEL]);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped external/library boundary
    for (const d of r.drillings as any[]) detail.push([...base, '', null, '', d.type?.name ?? '', d.meters, '', null, '', '']);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped external/library boundary
    for (const d of r.downtimes as any[]) detail.push([...base, '', null, '', '', null, d.reason?.name ?? '', d.duration, d.comment || '', '']);
    if (!r.piles.length && !r.drillings.length && !r.downtimes.length) {
      detail.push([...base, '', null, '', '', null, '', null, '', '']);
    }
  }

  // --- Лист 2: итоги по отчёту. ---
  const totals: (string | number | null)[][] = [[
    'ID отчёта', 'Дата', 'Смена', 'Объект', 'Оператор', 'Установка',
    'Свай, всего', 'Свай, м.п.', 'Бурение, скв.', 'Бурение, м', 'Простой, ч', 'Остаток топлива, %', 'Примечание', 'Статус', 'Моточасы на конец, м/ч',
  ]];
  const drafts: (string | number | null)[][] = [totals[0]];
  for (const r of reports) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped external/library boundary
    const piles = (r.piles as any[]).reduce((s, p) => s + p.count, 0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped external/library boundary
    const pileMeters = (r.piles as any[]).reduce((s, p) => s + pileRowMeters(p), 0);
    // Марка без длины: м.п. неполные, и по файлу это должно быть видно.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped external/library boundary
    const pilesWithoutLength = (r.piles as any[]).some((p) => pileRowMeters(p) === 0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped external/library boundary
    const wells = (r.drillings as any[]).reduce((s, d) => s + d.count, 0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped external/library boundary
    const meters = (r.drillings as any[]).reduce((s, d) => s + d.meters, 0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped external/library boundary
    const downtime = (r.downtimes as any[]).reduce((s, d) => s + d.duration, 0);
    (isSubmittedReport(r) ? totals : drafts).push([
      r.reportId, formatRuDate(r.date), shiftLabel(r.shiftType), r.site.name, r.user.name, r.equipment?.name || r.crew?.equipment?.name || '',
      piles, pileMeters, wells, meters, downtime, r.endingFuelPercent ?? null,
      pilesWithoutLength ? PILE_METERS_INCOMPLETE_NOTE : '', reportStatusExportLabel(r.status), r.endingEngineHours ?? null,
    ]);
  }

  return buildXlsx([
    { name: 'Детализация', rows: detail },
    { name: 'Итоги', rows: totals },
    ...(drafts.length > 1 ? [{ name: 'Черновики', rows: drafts }] : []),
  ]);
}
