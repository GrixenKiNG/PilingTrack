import { inflateRawSync } from 'node:zlib';
import { expect } from 'vitest';

/** Читает ZIP по центральному каталогу, не используя писатель продукта. */
export function parts(buffer: Buffer): Map<string, string> {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(end).toBeGreaterThan(0);
  const files = new Map<string, string>();
  let cursor = buffer.readUInt32LE(end + 16);
  for (let i = 0; i < buffer.readUInt16LE(end + 10); i++) {
    expect(buffer.readUInt32LE(cursor)).toBe(0x02014b50);
    const method = buffer.readUInt16LE(cursor + 10);
    const size = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString();
    const local = buffer.readUInt32LE(cursor + 42);
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const data = buffer.subarray(start, start + size);
    files.set(name, (method === 8 ? inflateRawSync(data) : data).toString());
    cursor += 46 + nameLength + buffer.readUInt16LE(cursor + 30) + buffer.readUInt16LE(cursor + 32);
  }
  return files;
}

const unescapeXml = (text: string): string =>
  text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** Колонка A1-ссылки → индекс с нуля («A» → 0, «AB» → 27). */
function columnIndex(ref: string): number {
  return [...ref.replace(/\d+/g, '')].reduce((sum, ch) => sum * 26 + ch.charCodeAt(0) - 64, 0) - 1;
}

/** Ячейки листа сеткой «строка × колонка»: число — числом, текст — строкой, пустая — null. */
export function sheetGrid(xml: string): Array<Array<string | number | null>> {
  const grid: Array<Array<string | number | null>> = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const row: Array<string | number | null> = [];
    for (const cell of (rowMatch[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /\br="([A-Z]+\d+)"/.exec(cell[1])?.[1];
      if (!ref) continue;
      const text = /<t\b[^>]*>([\s\S]*?)<\/t>/.exec(cell[2] ?? '')?.[1];
      const value = /<v>([\s\S]*?)<\/v>/.exec(cell[2] ?? '')?.[1];
      row[columnIndex(ref)] = text !== undefined ? unescapeXml(text) : value !== undefined ? Number(value) : null;
    }
    grid[Number(rowMatch[1]) - 1] = Array.from(row, (cell) => cell ?? null);
  }
  return Array.from(grid, (row) => row ?? []);
}

/** Первый лист выгрузки как сетка. */
export function firstSheet(buffer: Buffer): Array<Array<string | number | null>> {
  const xml = parts(buffer).get('xl/worksheets/sheet1.xml');
  if (!xml) throw new Error('Missing first XLSX worksheet');
  return sheetGrid(xml);
}
