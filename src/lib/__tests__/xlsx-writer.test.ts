import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildXlsx, type XlsxSheet } from '@/lib/xlsx-writer';

/**
 * Тесты смотрят на то, что реально попадает в .xlsx: сборка ZIP разбирается
 * обратно на OOXML-части. Внутренние функции писателя (xmlEscape, sheetXml)
 * не мокаются и не вызываются напрямую — проверяется наблюдаемый файл.
 */
function readParts(sheets: XlsxSheet[]): Record<string, Buffer> {
  const buf = buildXlsx(sheets);
  const parts: Record<string, Buffer> = {};
  let offset = 0;
  // Записи идут подряд локальными заголовками ZIP (флаг data descriptor не выставлен).
  while (offset + 30 <= buf.length && buf.readUInt32LE(offset) === 0x04034b50) {
    const compSize = buf.readUInt32LE(offset + 18);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const name = buf.subarray(offset + 30, offset + 30 + nameLen).toString('utf8');
    const start = offset + 30 + nameLen + extraLen;
    parts[name] = inflateRawSync(buf.subarray(start, start + compSize));
    offset = start + compSize;
  }
  return parts;
}

function sheetXml(rows: XlsxSheet['rows'], name = 'Лист'): string {
  return readParts([{ name, rows }])['xl/worksheets/sheet1.xml'].toString('utf8');
}

function rowXml(xml: string, row: number): string {
  return xml.match(new RegExp(`<row r="${row}">[\\s\\S]*?</row>`))?.[0] ?? '';
}

describe('xlsx-writer — запись листа', () => {
  it('шапка идёт первой строкой с жирным стилем, строки данных — без стиля', () => {
    const xml = sheetXml([
      ['Дата', 'Свай, шт'],
      ['2026-09-25', 3],
    ]);

    expect(rowXml(xml, 1)).toContain('<c r="A1" s="1" t="inlineStr">');
    expect(rowXml(xml, 1)).toContain('<c r="B1" s="1" t="inlineStr">');
    expect(rowXml(xml, 2)).not.toContain('s="1"');
  });

  it('числа пишутся числом, а текст — inline-строкой, даже если выглядит числом', () => {
    const xml = sheetXml([
      ['Свай, шт', 'Метры'],
      [12, 12.5],
      ['12', 'Свая'],
    ]);

    expect(xml).toContain('<c r="A2"><v>12</v></c>');
    expect(xml).toContain('<c r="B2"><v>12.5</v></c>');
    // «12» строкой остаётся текстом: Excel не должен превращать её в число.
    expect(xml).toContain('<c r="A3" t="inlineStr"><is><t xml:space="preserve">12</t></is></c>');
  });

  it('строка, начинающаяся с «=», остаётся текстом, а не формулой', () => {
    const xml = sheetXml([['Итог'], ['=SUM(A2:A3)'], ['=1+1']]);

    // Формула в OOXML — это <f>; его быть не должно, значение уходит inline-строкой.
    expect(xml).not.toContain('<f');
    expect(xml).toContain('<is><t xml:space="preserve">=SUM(A2:A3)</t></is>');
    expect(xml).toContain('<is><t xml:space="preserve">=1+1</t></is>');
  });

  it('экранирует XML-спецсимволы в тексте ячейки', () => {
    const xml = sheetXml([['Значение'], ['ООО "Ромашка" & <Ко> \'x\'']]);

    expect(xml).toContain('ООО &quot;Ромашка&quot; &amp; &lt;Ко&gt; &apos;x&apos;');
    // Сырые символы разметки в текст ячейки не попадают.
    expect(xml).not.toContain('<Ко>');
    expect(xml).not.toContain('"Ромашка"');
  });

  it('кириллица сохраняется без искажений', () => {
    const value = 'Свая С-300 «Тест», м.п.';
    const xml = sheetXml([['Марка'], [value]]);

    expect(xml).toContain(value);
    expect(xml).not.toContain('\uFFFD');
  });

  it('пустая таблица даёт пустой sheetData и корректный ZIP', () => {
    const buf = buildXlsx([{ name: 'Пусто', rows: [] }]);

    // Локальный заголовок первой записи и EOCD в конце — файл распаковывается.
    expect(buf.readUInt32LE(0)).toBe(0x04034b50);
    expect(buf.readUInt32LE(buf.length - 22)).toBe(0x06054b50);

    const xml = readParts([{ name: 'Пусто', rows: [] }])['xl/worksheets/sheet1.xml'].toString('utf8');
    expect(xml).toContain('<sheetData></sheetData>');
    expect(xml).not.toContain('<row');
  });

  it('вычищает управляющие символы, из-за которых Excel не открывает файл', () => {
    const xml = sheetXml([['Текст'], ['Свая\u0007 300\u001F']]);

    expect(xml).not.toMatch(/[\x00-\x08\x0B\x0C\x0E-\x1F]/);
    expect(xml).toContain('Свая 300');
  });

  // Имя листа обрезается до 31 символа ДО экранирования: иначе «&» у границы даёт
  // оборванную сущность (name="…&") — невалидный XML, Excel такой файл не откроет.
  it('обрезает длинное имя листа, не разрывая XML-сущность', () => {
    const longName = `${'a'.repeat(30)}&b`;
    const workbook = readParts([{ name: longName, rows: [['x']] }])['xl/workbook.xml'].toString('utf8');

    expect(workbook).toContain(`name="${'a'.repeat(30)}&amp;"`);
  });
});
