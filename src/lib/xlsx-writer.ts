/**
 * Минимальный генератор настоящих .xlsx — без внешних зависимостей.
 *
 * ЗАЧЕМ СВОЙ, а не exceljs. CSV уже есть, но в Excel он то и дело съезжает:
 * кириллица, разделитель, числа как текст. Настоящий .xlsx открывается без
 * плясок и хранит числа числами. Полновесная библиотека (exceljs) сюда не
 * встала — окружение не тянет её из реестра стабильно, — а формат нам нужен
 * узкий: несколько листов, строки текста и чисел, жирная шапка. Столько кода
 * тут и есть; ZIP собирается через встроенный zlib.
 *
 * .xlsx — это ZIP с XML внутри (OOXML). Пишем inline-строки (без общей таблицы
 * строк), числа — тегом <v>, шапку — одним стилем. Этого достаточно для выгрузок.
 */

import { deflateRawSync } from 'zlib';

export type XlsxCell = string | number | null | undefined;

export interface XlsxSheet {
  name: string;
  /** Первая строка — шапка (выделяется жирным). */
  rows: XlsxCell[][];
}

// --- CRC32 (нужен для каждой записи ZIP) ---
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Excel запрещает управляющие символы в XML — вычищаем, иначе файл не откроется.
function sanitize(value: string): string {
   
  return value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

function colLetter(index: number): string {
  let n = index;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

function sheetXml(sheet: XlsxSheet): string {
  const rowsXml = sheet.rows
    .map((row, r) => {
      const rowNum = r + 1;
      const cells = row
        .map((cell, c) => {
          const ref = `${colLetter(c)}${rowNum}`;
          const style = r === 0 ? ' s="1"' : '';
          if (cell == null || cell === '') return `<c r="${ref}"${style}/>`;
          if (typeof cell === 'number' && Number.isFinite(cell)) {
            return `<c r="${ref}"${style}><v>${cell}</v></c>`;
          }
          const text = xmlEscape(sanitize(String(cell)));
          return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
        })
        .join('');
      return `<row r="${rowNum}">${cells}</row>`;
    })
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetData>${rowsXml}</sheetData></worksheet>`
  );
}

function buildParts(sheets: XlsxSheet[]): Record<string, string> {
  const sheetFiles: Record<string, string> = {};
  sheets.forEach((sheet, i) => {
    sheetFiles[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(sheet);
  });

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    sheets
      .map(
        (_, i) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join('') +
    '</Types>';

  const rootRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';

  const workbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
    sheets
      .map((sheet, i) => `<sheet name="${xmlEscape(sanitize(sheet.name)).slice(0, 31)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join('') +
    '</sheets></workbook>';

  const workbookRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheets
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join('') +
    `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    '</Relationships>';

  // Один нестандартный стиль (s="1") — жирная шапка.
  const styles =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>' +
    '<borders count="1"><border/></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
    '</styleSheet>';

  return {
    '[Content_Types].xml': contentTypes,
    '_rels/.rels': rootRels,
    'xl/workbook.xml': workbook,
    'xl/_rels/workbook.xml.rels': workbookRels,
    'xl/styles.xml': styles,
    ...sheetFiles,
  };
}

interface ZipEntry {
  name: Buffer;
  crc: number;
  compSize: number;
  rawSize: number;
  offset: number;
}

/** Собирает настоящий .xlsx (ZIP из OOXML-частей) и возвращает Buffer. */
export function buildXlsx(sheets: XlsxSheet[]): Buffer {
  const parts = buildParts(sheets);
  const chunks: Buffer[] = [];
  const entries: ZipEntry[] = [];
  let offset = 0;

  for (const [path, xml] of Object.entries(parts)) {
    const raw = Buffer.from(xml, 'utf8');
    const compressed = deflateRawSync(raw);
    const name = Buffer.from(path, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(8, 8); // method = deflate
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0, 12); // mod date
    const crc = crc32(raw);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra len
    chunks.push(local, name, compressed);
    entries.push({ name, crc, compSize: compressed.length, rawSize: raw.length, offset });
    offset += local.length + name.length + compressed.length;
  }

  const central: Buffer[] = [];
  let centralSize = 0;
  for (const e of entries) {
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(20, 4); // version made by
    head.writeUInt16LE(20, 6); // version needed
    head.writeUInt16LE(0, 8); // flags
    head.writeUInt16LE(8, 10); // method
    head.writeUInt16LE(0, 12); // time
    head.writeUInt16LE(0, 14); // date
    head.writeUInt32LE(e.crc, 16);
    head.writeUInt32LE(e.compSize, 20);
    head.writeUInt32LE(e.rawSize, 24);
    head.writeUInt16LE(e.name.length, 28);
    head.writeUInt16LE(0, 30); // extra
    head.writeUInt16LE(0, 32); // comment
    head.writeUInt16LE(0, 34); // disk
    head.writeUInt16LE(0, 36); // internal attrs
    head.writeUInt32LE(0, 38); // external attrs
    head.writeUInt32LE(e.offset, 42);
    central.push(head, e.name);
    centralSize += head.length + e.name.length;
  }

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // disk
  eocd.writeUInt16LE(0, 6); // cd start disk
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20); // comment len

  return Buffer.concat([...chunks, ...central, eocd]);
}
