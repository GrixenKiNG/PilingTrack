import {createHash} from 'node:crypto';

const FORMULA_PREFIX = /^(?:[\t\r]|\s*[=+\-@])/;

export function safeCsvCell(value: unknown): string {
  let text = value == null ? '' : value instanceof Date ? value.toISOString() : String(value);
  if (FORMULA_PREFIX.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export function csvRows(rows: readonly (readonly unknown[])[]): string {
  return rows.map((row) => row.map(safeCsvCell).join(';')).join('\r\n');
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
  const data = csvRows(input.rows);
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
