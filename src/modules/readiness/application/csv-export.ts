import {createHash} from 'node:crypto';
import {formatRuDate} from '@/lib/format';
import {formatDateInTimezone} from '@/lib/timezone';

const FORMULA_PREFIX = /^(?:[\t\r]|\s*[=+\-@])/;
// То же исключение, что в CSV отчётов (report-export.service.ts): обычные числа
// не трогаем, иначе «-5» уехало бы в файл текстом и колонка перестала бы
// суммироваться, а «-5+A1» апостроф получит.
const PLAIN_NUMBER = /^-?\d+([.,]\d+)?$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const DATE_FORMAT: Intl.DateTimeFormatOptions = {year: 'numeric', month: '2-digit', day: '2-digit'};
const DATE_TIME_FORMAT: Intl.DateTimeFormatOptions = {
  ...DATE_FORMAT, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
};
const DEFAULT_TIMEZONE = 'Europe/Moscow';

/**
 * В выгрузке дата печатается так же, как на экране: момент времени (Date или
 * ISO-строка) — днём и временем пояса организации (ДД.ММ.ГГГГ ЧЧ:ММ),
 * «чистая» дата производственного дня (YYYY-MM-DD) — как есть, без сдвига.
 */
function csvCellText(value: unknown, timezone: string): string {
  if (value == null) return '';
  if (value instanceof Date) {
    return formatDateInTimezone(value, timezone, DATE_TIME_FORMAT).replace(', ', ' ');
  }
  // Дробное число печатаем через запятую, как csvDecimal в выгрузке отчётов
  // (D-20260930-007): русский Excel с разделителем «;» читает «16.7» текстом и
  // колонку не суммирует. Целые оставляем как есть — «2», а не «2,0». Строки не
  // трогаем: «16.7» оттуда может быть номером или кодом.
  if (typeof value === 'number' && Number.isFinite(value) && !Number.isInteger(value)) {
    return String(value).replace('.', ',');
  }
  if (typeof value === 'string') {
    if (DATE_ONLY.test(value)) return formatRuDate(value);
    if (TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value))) {
      return formatDateInTimezone(value, timezone, DATE_TIME_FORMAT).replace(', ', ' ');
    }
  }
  return String(value);
}

export function safeCsvCell(value: unknown, timezone: string = DEFAULT_TIMEZONE): string {
  let text = csvCellText(value, timezone);
  if (!PLAIN_NUMBER.test(text.trimStart()) && FORMULA_PREFIX.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export function csvRows(rows: readonly (readonly unknown[])[], timezone: string = DEFAULT_TIMEZONE): string {
  return rows.map((row) => row.map((cell) => safeCsvCell(cell, timezone)).join(';')).join('\r\n');
}

export function csvSha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function buildReadinessCsv(input: {
  dataset: string;
  timezone: string;
  generatedAt: Date;
  filters: unknown;
  rows: readonly (readonly unknown[])[];
}): {body: string; hash: string} {
  const data = csvRows(input.rows, input.timezone);
  const hash = csvSha256(data);
  const metadata = csvRows([
    ['PilingTrack readiness export', input.dataset],
    ['timezone', input.timezone],
    ['generated_at', input.generatedAt.toISOString()],
    ['filters', JSON.stringify(input.filters)],
    ['data_sha256', hash],
    [],
  ]);
  return {body: '\uFEFF' + metadata + data + '\r\n', hash};
}
