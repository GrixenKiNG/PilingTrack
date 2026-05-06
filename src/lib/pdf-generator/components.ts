import { COLORS, CONTENT_WIDTH, PAGE } from './constants';
import { formatNumber, formatRuDate, safeText } from './format';
import { sumDowntime, sumDrilling, sumPiles } from './period-row';
import type { PdfDoc, PeriodReportRow } from './types';

export function ensureSpace(doc: PdfDoc, neededHeight: number) {
  if (doc.y + neededHeight > PAGE.height - PAGE.bottom) {
    doc.addPage();
    doc.x = PAGE.left;
    doc.y = PAGE.top;
  }
}

export function addHeader(doc: PdfDoc, title: string, subtitle: string) {
  doc.x = PAGE.left;
  doc.y = PAGE.top;

  doc.font('Bold').fontSize(22).fillColor(COLORS.dark);
  doc.text('PILINGTRACK', PAGE.left, doc.y, { width: CONTENT_WIDTH, align: 'center' });

  const lineWidth = 150;
  const lineX = PAGE.left + (CONTENT_WIDTH - lineWidth) / 2;
  doc.rect(lineX, doc.y + 4, lineWidth, 3).fill(COLORS.accent);
  doc.y += 18;

  doc.font('Bold').fontSize(13).fillColor(COLORS.dark);
  doc.text(title, PAGE.left, doc.y, { width: CONTENT_WIDTH, align: 'center' });
  doc.moveDown(0.35);
  doc.font('Regular').fontSize(9).fillColor(COLORS.muted);
  doc.text(subtitle, PAGE.left, doc.y, { width: CONTENT_WIDTH, align: 'center' });

  doc.moveDown(0.6);
  doc.moveTo(PAGE.left, doc.y).lineTo(PAGE.left + CONTENT_WIDTH, doc.y).strokeColor(COLORS.border).lineWidth(1).stroke();
  doc.y += 12;
  doc.fillColor(COLORS.text);
}

export function addInfoGrid(doc: PdfDoc, rows: string[][]) {
  const rowHeight = 24;
  const labelWidth = CONTENT_WIDTH * 0.18;
  const valueWidth = CONTENT_WIDTH * 0.32;

  ensureSpace(doc, rows.length * rowHeight + 16);

  rows.forEach((row, index) => {
    const y = doc.y;
    const fill = index % 2 === 0 ? COLORS.white : COLORS.alt;
    doc.rect(PAGE.left, y, CONTENT_WIDTH, rowHeight).fill(fill).strokeColor(COLORS.border).lineWidth(0.5).stroke();

    const x1 = PAGE.left + labelWidth;
    const x2 = PAGE.left + labelWidth + valueWidth;
    const x3 = PAGE.left + labelWidth + valueWidth + labelWidth;
    [x1, x2, x3].forEach((x) => doc.moveTo(x, y).lineTo(x, y + rowHeight).strokeColor(COLORS.border).stroke());

    doc.font('Bold').fontSize(8).fillColor(COLORS.muted);
    doc.text(row[0], PAGE.left + 6, y + 7, { width: labelWidth - 10, height: rowHeight - 8 });
    doc.text(row[2], x2 + 6, y + 7, { width: labelWidth - 10, height: rowHeight - 8 });

    doc.font('Regular').fontSize(8.5).fillColor(COLORS.dark);
    doc.text(row[1], x1 + 6, y + 7, { width: valueWidth - 10, height: rowHeight - 8 });
    doc.text(row[3], x3 + 6, y + 7, { width: valueWidth - 10, height: rowHeight - 8 });

    doc.y = y + rowHeight;
  });

  doc.y += 14;
}

export function addMetricStrip(doc: PdfDoc, metrics: Array<[string, string, string]>) {
  const height = 76;
  const columnWidth = CONTENT_WIDTH / metrics.length;
  ensureSpace(doc, height + 16);

  const y = doc.y;
  doc.rect(PAGE.left, y, CONTENT_WIDTH, height).fill(COLORS.header).strokeColor(COLORS.border).lineWidth(0.5).stroke();
  doc.rect(PAGE.left, y, CONTENT_WIDTH, 3).fill(COLORS.accent);

  metrics.forEach(([label, value, unit], index) => {
    const x = PAGE.left + columnWidth * index;
    if (index > 0) {
      doc.moveTo(x, y + 14).lineTo(x, y + height - 14).strokeColor(COLORS.border).stroke();
    }

    doc.font('Regular').fontSize(8).fillColor(COLORS.muted);
    doc.text(label, x + 12, y + 18, { width: columnWidth - 24 });

    const valueParts = value.split(' / ');
    const unitParts = unit.split(' / ');
    if (valueParts.length === 2 && unitParts.length === 2) {
      doc.font('Bold').fontSize(12).fillColor(COLORS.dark);
      doc.text(`${valueParts[0]} ${unitParts[0]}`, x + 12, y + 32, {
        width: columnWidth - 24, lineBreak: false, ellipsis: true,
      });
      doc.font('Bold').fontSize(11).fillColor(COLORS.dark);
      doc.text(`${valueParts[1]} ${unitParts[1]}`, x + 12, y + 50, {
        width: columnWidth - 24, lineBreak: false, ellipsis: true,
      });
    } else {
      doc.font('Bold').fontSize(15).fillColor(COLORS.dark);
      doc.text(value, x + 12, y + 34, {
        width: columnWidth - 24, lineBreak: false, ellipsis: true,
      });
      doc.font('Regular').fontSize(8).fillColor(COLORS.muted);
      doc.text(unit, x + 12, y + 54, { width: columnWidth - 24 });
    }
  });

  doc.y = y + height + 16;
}

export function addSectionTitle(doc: PdfDoc, title: string) {
  ensureSpace(doc, 36);
  doc.font('Bold').fontSize(11).fillColor(COLORS.dark);
  doc.text(title, PAGE.left, doc.y, { width: CONTENT_WIDTH });
  doc.rect(PAGE.left, doc.y + 2, 80, 2).fill(COLORS.accent);
  doc.y += 12;
}

function drawTableRow(
  doc: PdfDoc,
  cells: string[],
  colWidths: number[],
  height: number,
  isHeader: boolean,
  isAlt = false
) {
  const y = doc.y;
  let x = PAGE.left;
  const fill = isHeader ? COLORS.dark : isAlt ? COLORS.alt : COLORS.white;

  doc.rect(PAGE.left, y, CONTENT_WIDTH, height).fill(fill).strokeColor(COLORS.border).lineWidth(0.5).stroke();
  cells.forEach((cell, index) => {
    const width = colWidths[index] || 0;
    if (index > 0) {
      doc.moveTo(x, y).lineTo(x, y + height).strokeColor(COLORS.border).stroke();
    }
    doc.font(isHeader ? 'Bold' : 'Regular')
      .fontSize(isHeader ? 8 : 8.2)
      .fillColor(isHeader ? COLORS.white : COLORS.text);
    doc.text(safeText(cell), x + 6, y + 7, { width: width - 12, height: height - 8, ellipsis: true });
    x += width;
  });

  doc.y = y + height;
}

export function addTable(
  doc: PdfDoc,
  headers: string[],
  rows: string[][],
  widths: number[],
  compact = false
) {
  const rowHeight = compact ? 21 : 24;
  const headerHeight = compact ? 20 : 22;
  const colWidths = widths.map((width) => CONTENT_WIDTH * width);

  ensureSpace(doc, headerHeight + rowHeight + 8);
  drawTableRow(doc, headers, colWidths, headerHeight, true);

  rows.forEach((row, index) => {
    ensureSpace(doc, rowHeight + 8);
    drawTableRow(doc, row, colWidths, rowHeight, false, index % 2 === 1);
  });

  doc.y += compact ? 5 : 10;
}

export function addPeriodTable(doc: PdfDoc, reports: PeriodReportRow[]) {
  addTable(
    doc,
    ['Дата', 'Объект', 'Оператор', 'Сваи', 'Бурение', 'Простои'],
    reports.map((report) => [
      formatRuDate(report.date || ''),
      report.site?.name || '—',
      report.user?.name || '—',
      formatNumber(sumPiles(report)),
      formatNumber(sumDrilling(report)),
      formatNumber(sumDowntime(report)),
    ]),
    [0.13, 0.22, 0.23, 0.12, 0.15, 0.15]
  );
}

export function addReportBreakdown(doc: PdfDoc, report: PeriodReportRow, index: number) {
  ensureSpace(doc, 54);
  const title = `${index}. ${formatRuDate(report.date || '')} | ${report.site?.name || 'Объект'} | ${report.user?.name || 'Оператор'}`;
  doc.font('Bold').fontSize(9.5).fillColor(COLORS.dark);
  doc.text(title, PAGE.left, doc.y, { width: CONTENT_WIDTH });
  doc.moveDown(0.25);

  if ((report.piles || []).length > 0) {
    addTable(
      doc,
      ['Свайные работы', 'Кол-во'],
      (report.piles || []).map((pile) => [pile.pileGrade?.name || '—', formatNumber(pile.count || 0)]),
      [0.72, 0.28],
      true
    );
  }

  if ((report.drillings || []).length > 0) {
    addTable(
      doc,
      ['Бурение', 'Метров'],
      (report.drillings || []).map((drilling) => [drilling.type?.name || '—', formatNumber(drilling.meters || 0)]),
      [0.72, 0.28],
      true
    );
  }

  if ((report.downtimes || []).length > 0) {
    addTable(
      doc,
      ['Простой', 'Часы'],
      (report.downtimes || []).map((downtime) => [downtime.reason?.name || '—', formatNumber(downtime.duration || 0)]),
      [0.72, 0.28],
      true
    );
  }

  doc.y += 8;
}

export function addEmptyState(doc: PdfDoc, message: string) {
  ensureSpace(doc, 92);
  const y = doc.y;
  doc.rect(PAGE.left, y, CONTENT_WIDTH, 72).fill(COLORS.header).strokeColor(COLORS.border).lineWidth(0.5).stroke();
  doc.font('Bold').fontSize(12).fillColor(COLORS.dark);
  doc.text('Нет данных', PAGE.left, y + 18, { width: CONTENT_WIDTH, align: 'center' });
  doc.font('Regular').fontSize(9).fillColor(COLORS.muted);
  doc.text(message, PAGE.left + 24, y + 40, { width: CONTENT_WIDTH - 48, align: 'center' });
  doc.y = y + 88;
}

export function addFooterAndPageNumbers(doc: PdfDoc) {
  const range = doc.bufferedPageRange();
  for (let pageIndex = range.start; pageIndex < range.start + range.count; pageIndex += 1) {
    doc.switchToPage(pageIndex);
    const y = PAGE.height - PAGE.bottom + 8;
    doc.moveTo(PAGE.left, y - 12).lineTo(PAGE.left + CONTENT_WIDTH, y - 12).strokeColor(COLORS.border).stroke();
    doc.font('Regular').fontSize(7.5).fillColor(COLORS.muted);
    doc.text(`PilingTrack | сформировано ${new Date().toLocaleString('ru-RU')}`, PAGE.left, y, {
      width: CONTENT_WIDTH / 2,
      align: 'left',
    });
    doc.text(`${pageIndex + 1} / ${range.count}`, PAGE.left, y, {
      width: CONTENT_WIDTH,
      align: 'right',
    });
  }
  doc.fillColor(COLORS.text);
}
