/**
 * In-process PDF generation for report exports.
 *
 * The generator intentionally avoids child processes and temporary files so API
 * routes and workers share one deterministic render path.
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import PDFDocument from 'pdfkit';

// ============================================================
// Types
// ============================================================

export interface PeriodPdfData {
  dateFrom: string;
  dateTo: string;
  siteId: string;
  reports: unknown[];
  totalPiles: number;
  totalDrilling: number;
  totalDowntime: number;
}

export interface SingleReportData {
  reportId: string;
  date: string;
  shiftStart: string | null;
  shiftEnd: string | null;
  shiftType: string;
  status: string;
  lastEditedByName: string | null;
  lastEditedByRole: string | null;
  assistantName: string;
  equipmentName: string;
  user: { name: string } | null;
  site: { name: string } | null;
  piles: { pileGrade: { name: string }; count: number; metersPerUnit?: number }[];
  drillings: { type: { name: string }; count?: number; metersPerUnit?: number; meters: number }[];
  downtimes: { reason: { name: string }; duration: number; comment: string | null }[];
}

export type PdfJobData = PeriodPdfData | SingleReportData;

type PdfDoc = InstanceType<typeof PDFDocument>;

interface FontPaths {
  Regular: string;
  Bold: string;
  Oblique: string;
  BoldOblique: string;
  Serif: string;
  SerifBold: string;
}

interface PeriodReportRow {
  reportId?: string | null;
  date?: string | null;
  shiftType?: string | null;
  status?: string | null;
  assistantName?: string | null;
  equipmentName?: string | null;
  user?: { name?: string | null } | null;
  site?: { name?: string | null } | null;
  piles?: Array<{ pileGrade?: { name?: string | null } | null; count?: number | null; metersPerUnit?: number | null }> | null;
  drillings?: Array<{ type?: { name?: string | null } | null; count?: number | null; meters?: number | null }> | null;
  downtimes?: Array<{ reason?: { name?: string | null } | null; duration?: number | null; comment?: string | null }> | null;
}

const COLORS = {
  accent: '#f97316',
  dark: '#1e293b',
  text: '#334155',
  muted: '#64748b',
  border: '#e2e8f0',
  header: '#f8fafc',
  alt: '#fafafa',
  total: '#f1f5f9',
  white: '#ffffff',
};

const PAGE = {
  width: 595.28,
  height: 841.89,
  top: 45,
  bottom: 45,
  left: 50,
  right: 50,
};

const CONTENT_WIDTH = PAGE.width - PAGE.left - PAGE.right;

// ============================================================
// Public API
// ============================================================

export async function generatePeriodPdf(data: PeriodPdfData): Promise<Buffer> {
  return renderPdf((doc) => {
    const reports = data.reports.map(toPeriodReportRow);
    const totalDrillingCount = reports.reduce(
      (sum, report) =>
        sum + (report.drillings || []).reduce((inner, drilling) => inner + (drilling.count || 1), 0),
      0
    );

    addHeader(doc, 'СВОДНЫЙ ОТЧЁТ ЗА ПЕРИОД', `${formatRuDate(data.dateFrom)} - ${formatRuDate(data.dateTo)}`);
    addMetricStrip(doc, [
      ['Отчётов', String(reports.length), 'шт'],
      ['Свай забито', formatNumber(data.totalPiles), 'шт'],
      ['Бурение', `${formatNumber(totalDrillingCount)} / ${formatNumber(data.totalDrilling)}`, 'шт / м.п.'],
      ['Простои', formatNumber(data.totalDowntime), 'ч'],
    ]);

    if (reports.length === 0) {
      addEmptyState(doc, 'За выбранный период отчётов нет.');
      return;
    }

    addSectionTitle(doc, 'Список отчётов');
    addPeriodTable(doc, reports);

    addSectionTitle(doc, 'Детализация работ');
    reports.forEach((report, index) => addReportBreakdown(doc, report, index + 1));
  });
}

export async function generateSinglePdf(data: SingleReportData): Promise<Buffer> {
  return renderPdf((doc) => {
    const totalPiles = data.piles.reduce((sum, pile) => sum + (pile.count || 0), 0);
    const totalPileMeters = data.piles.reduce(
      (sum, pile) => sum + (pile.count || 0) * (pile.metersPerUnit || 0),
      0
    );
    const totalDrillingCount = data.drillings.reduce((sum, drilling) => sum + (drilling.count || 1), 0);
    const totalDrilling = data.drillings.reduce((sum, drilling) => sum + (drilling.meters || 0), 0);
    const totalDowntime = data.downtimes.reduce((sum, downtime) => sum + (downtime.duration || 0), 0);

    addHeader(doc, 'РАБОЧИЙ ОТЧЁТ ПО СВАЙНЫМ РАБОТАМ', `№ ${shortId(data.reportId)} | ${formatRuDate(data.date)}`);
    addInfoGrid(doc, [
      ['Объект', data.site?.name || '—', 'Дата', formatRuDate(data.date)],
      ['Оператор', data.user?.name || '—', 'Смена', `${shiftLabel(data.shiftType)} ${data.shiftStart || ''}-${data.shiftEnd || ''}`],
      ['Помощник', data.assistantName || '—', 'Оборудование', data.equipmentName || '—'],
      ['Статус', statusLabel(data.status), 'Изменил', editorLabel(data.lastEditedByRole, data.lastEditedByName)],
    ]);

    const hasWork = data.piles.length > 0 || data.drillings.length > 0 || data.downtimes.length > 0;
    if (!hasWork) {
      addEmptyState(doc, 'В отчёте нет производственных работ или простоев.');
      return;
    }

    addMetricStrip(doc, [
      ['Свай забито', formatNumber(totalPiles), 'шт'],
      ['Сваи всего', formatNumber(totalPileMeters), 'м.п.'],
      ['Бурение', `${formatNumber(totalDrillingCount)} / ${formatNumber(totalDrilling)}`, 'шт / м.п.'],
      ['Простои', formatNumber(totalDowntime), 'ч'],
    ]);

    if (data.piles.length > 0) {
      addSectionTitle(doc, 'Свайные работы');
      addTable(
        doc,
        ['Марка сваи', 'Кол-во', 'Метров на сваю', 'Всего м.п.'],
        data.piles.map((pile) => [
          pile.pileGrade?.name || '—',
          formatNumber(pile.count),
          formatNumber(pile.metersPerUnit || 0),
          formatNumber((pile.count || 0) * (pile.metersPerUnit || 0)),
        ]),
        [0.46, 0.16, 0.18, 0.2]
      );
    }

    if (data.drillings.length > 0) {
      addSectionTitle(doc, 'Лидерное бурение');
      addTable(
        doc,
        ['Тип', 'Кол-во', 'Метров на ед.', 'Всего м.п.'],
        data.drillings.map((drilling) => [
          drilling.type?.name || '—',
          formatNumber(drilling.count || 1),
          formatNumber(drilling.metersPerUnit || 0),
          formatNumber(drilling.meters || 0),
        ]),
        [0.46, 0.16, 0.18, 0.2]
      );
    }

    if (data.downtimes.length > 0) {
      addSectionTitle(doc, 'Простои');
      addTable(
        doc,
        ['Причина', 'Длительность', 'Комментарий'],
        data.downtimes.map((downtime) => [
          downtime.reason?.name || '—',
          `${formatNumber(downtime.duration)} ч`,
          downtime.comment || '—',
        ]),
        [0.48, 0.18, 0.34]
      );
    }
  });
}

export function savePdfBuffer(jobId: string, pdfBuffer: Buffer): string {
  const dir = join(process.cwd(), 'storage', 'pdf-results');
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${jobId}.pdf`);
  writeFileSync(filePath, pdfBuffer);
  return filePath;
}

export function readPdfResult(jobId: string): Buffer {
  const filePath = join(process.cwd(), 'storage', 'pdf-results', `${jobId}.pdf`);
  return readFileSync(filePath);
}

export function deletePdfResult(jobId: string): void {
  try {
    const filePath = join(process.cwd(), 'storage', 'pdf-results', `${jobId}.pdf`);
    unlinkSync(filePath);
  } catch {
    // The result may already be removed by TTL cleanup or manual maintenance.
  }
}

// ============================================================
// Rendering primitives
// ============================================================

function renderPdf(draw: (doc: PdfDoc) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // font: false — skip loading the built-in Helvetica.afm at construction time.
    // Bundlers (Turbopack/webpack) do not reliably include pdfkit's internal .afm
    // assets, so we register our own TTF fonts in registerFonts() right after.
    const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true, font: false as any });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    try {
      registerFonts(doc);
      draw(doc);
      addFooterAndPageNumbers(doc);
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

function registerFonts(doc: PdfDoc) {
  const fonts = resolvePdfFonts();
  for (const [name, path] of Object.entries(fonts)) {
    doc.registerFont(name, path);
  }
  doc.font('Regular');
}

function addHeader(doc: PdfDoc, title: string, subtitle: string) {
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

function addInfoGrid(doc: PdfDoc, rows: string[][]) {
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

function addMetricStrip(doc: PdfDoc, metrics: Array<[string, string, string]>) {
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
    doc.font('Bold').fontSize(15).fillColor(COLORS.dark);
    doc.text(value, x + 12, y + 34, { width: columnWidth - 24 });
    doc.font('Regular').fontSize(8).fillColor(COLORS.muted);
    doc.text(unit, x + 12, y + 54, { width: columnWidth - 24 });
  });

  doc.y = y + height + 16;
}

function addSectionTitle(doc: PdfDoc, title: string) {
  ensureSpace(doc, 36);
  doc.font('Bold').fontSize(11).fillColor(COLORS.dark);
  doc.text(title, PAGE.left, doc.y, { width: CONTENT_WIDTH });
  doc.rect(PAGE.left, doc.y + 2, 80, 2).fill(COLORS.accent);
  doc.y += 12;
}

function addPeriodTable(doc: PdfDoc, reports: PeriodReportRow[]) {
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

function addReportBreakdown(doc: PdfDoc, report: PeriodReportRow, index: number) {
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

function addTable(
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

function addEmptyState(doc: PdfDoc, message: string) {
  ensureSpace(doc, 92);
  const y = doc.y;
  doc.rect(PAGE.left, y, CONTENT_WIDTH, 72).fill(COLORS.header).strokeColor(COLORS.border).lineWidth(0.5).stroke();
  doc.font('Bold').fontSize(12).fillColor(COLORS.dark);
  doc.text('Нет данных', PAGE.left, y + 18, { width: CONTENT_WIDTH, align: 'center' });
  doc.font('Regular').fontSize(9).fillColor(COLORS.muted);
  doc.text(message, PAGE.left + 24, y + 40, { width: CONTENT_WIDTH - 48, align: 'center' });
  doc.y = y + 88;
}

function addFooterAndPageNumbers(doc: PdfDoc) {
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

function ensureSpace(doc: PdfDoc, neededHeight: number) {
  if (doc.y + neededHeight > PAGE.height - PAGE.bottom) {
    doc.addPage();
    doc.x = PAGE.left;
    doc.y = PAGE.top;
  }
}

// ============================================================
// Data helpers
// ============================================================

function toPeriodReportRow(value: unknown): PeriodReportRow {
  return (value && typeof value === 'object' ? value : {}) as PeriodReportRow;
}

function sumPiles(report: PeriodReportRow): number {
  return (report.piles || []).reduce((sum, pile) => sum + (pile.count || 0), 0);
}

function sumDrilling(report: PeriodReportRow): number {
  return (report.drillings || []).reduce((sum, drilling) => sum + (drilling.meters || 0), 0);
}

function sumDowntime(report: PeriodReportRow): number {
  return (report.downtimes || []).reduce((sum, downtime) => sum + (downtime.duration || 0), 0);
}

function safeText(value: unknown): string {
  const text = value === null || value === undefined || value === '' ? '—' : String(value);
  return text.replace(/\s+/g, ' ').trim();
}

function formatNumber(value: number | null | undefined): string {
  const numeric = Number(value || 0);
  return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(1);
}

function formatRuDate(value: string): string {
  if (!value) return '—';
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('ru-RU');
}

function shortId(value: string): string {
  return (value || '—').slice(0, 8).toUpperCase();
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    submitted: 'Отправлен',
    draft: 'Черновик',
    deleted: 'Удалён',
  };
  return labels[status] || status || '—';
}

function shiftLabel(shiftType: string): string {
  const labels: Record<string, string> = {
    DAY: 'Дневная',
    NIGHT: 'Ночная',
  };
  return labels[shiftType] || shiftType || '—';
}

function editorLabel(role: string | null, name: string | null): string {
  if (!name) return '—';
  const labels: Record<string, string> = {
    ADMIN: 'Администратор',
    DISPATCHER: 'Диспетчер',
    ASSISTANT: 'Помощник',
    OPERATOR: 'Оператор',
  };
  return `${labels[role || ''] || 'Оператор'}: ${name}`;
}

function firstExisting(candidates: string[]): string | null {
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

function resolvePdfFonts(): FontPaths {
  const windowsFontDir = process.env.WINDIR ? join(process.env.WINDIR, 'Fonts') : 'C:\\Windows\\Fonts';
  const regular = firstExisting([
    join(process.cwd(), 'public', 'fonts', 'DejaVuSans.ttf'),
    join(windowsFontDir, 'arial.ttf'),
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf',
  ]);
  const bold = firstExisting([
    join(process.cwd(), 'public', 'fonts', 'DejaVuSans-Bold.ttf'),
    join(windowsFontDir, 'arialbd.ttf'),
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf',
  ]);

  if (!regular || !bold) {
    throw new Error('No compatible PDF fonts found. Add DejaVu fonts to public/fonts or install system fonts.');
  }

  return {
    Regular: regular,
    Bold: bold,
    Oblique:
      firstExisting([
        join(process.cwd(), 'public', 'fonts', 'DejaVuSans-Oblique.ttf'),
        join(windowsFontDir, 'ariali.ttf'),
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf',
        '/usr/share/fonts/truetype/liberation2/LiberationSans-Italic.ttf',
      ]) || regular,
    BoldOblique:
      firstExisting([
        join(process.cwd(), 'public', 'fonts', 'DejaVuSans-BoldOblique.ttf'),
        join(windowsFontDir, 'arialbi.ttf'),
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-BoldOblique.ttf',
        '/usr/share/fonts/truetype/liberation2/LiberationSans-BoldItalic.ttf',
      ]) || bold,
    Serif:
      firstExisting([
        join(process.cwd(), 'public', 'fonts', 'DejaVuSerif.ttf'),
        join(windowsFontDir, 'times.ttf'),
        '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf',
        '/usr/share/fonts/truetype/liberation2/LiberationSerif-Regular.ttf',
      ]) || regular,
    SerifBold:
      firstExisting([
        join(process.cwd(), 'public', 'fonts', 'DejaVuSerif-Bold.ttf'),
        join(windowsFontDir, 'timesbd.ttf'),
        '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf',
        '/usr/share/fonts/truetype/liberation2/LiberationSerif-Bold.ttf',
      ]) || bold,
  };
}
