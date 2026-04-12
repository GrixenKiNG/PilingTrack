#!/usr/bin/env node
// Standalone single-report PDF generator — professional template
// Used by /api/reports/single-pdf via child_process
// Input: JSON file path as first argument — { report: { date, user: {name}, site: {name}, ... } }

const PDFDocument = require('pdfkit');
const fs = require('fs');
const { resolvePdfFonts } = require('./pdf-fonts');

// ── Font paths ──
const FONT = resolvePdfFonts();

// ── Color palette ──
const CLR = {
  orange:       '#f97316',
  orangeLight:  '#fff7ed',
  dark:         '#1e293b',
  text:         '#334155',
  textLight:    '#64748b',
  border:       '#e2e8f0',
  headerBg:     '#f8fafc',
  rowAlt:       '#fafafa',
  rowWhite:     '#ffffff',
  totalBg:      '#f1f5f9',
  summaryBg:    '#f8fafc',
};

// ── Layout constants ──
const MARGIN_TOP    = 45;
const MARGIN_BOTTOM = 45;
const MARGIN_LEFT   = 50;
const MARGIN_RIGHT  = 50;
const PAGE_W = 595.28; // A4 width
const PAGE_H = 841.89; // A4 height
const CONTENT_W = PAGE_W - MARGIN_LEFT - MARGIN_RIGHT;

// ── Read input ──
const inputPath = process.argv[2];
const outputPath = process.argv[3]; // optional: write to file instead of stdout
if (!inputPath) {
  process.stderr.write('Usage: generate-single-pdf.js <input.json> [output.pdf]\n');
  process.exit(1);
}

let data;
try {
  const raw = fs.readFileSync(inputPath, 'utf8');
  data = JSON.parse(raw);
} catch (err) {
  process.stderr.write(`Read error: ${err.message}\n`);
  process.exit(1);
}

if (!data.report) {
  process.stderr.write('Invalid input: missing "report" key\n');
  process.exit(1);
}

try {
  generatePdf(data.report);
} catch (err) {
  process.stderr.write(`Generation error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
}

// ═══════════════════════════════════════════════════════════
// MAIN GENERATION
// ═══════════════════════════════════════════════════════════

function generatePdf(report) {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 0,
    bufferPages: true,
  });

  // Register all fonts
  for (const [name, p] of Object.entries(FONT)) {
    doc.registerFont(name, p);
  }

  // ── Derived data ──
  const piles     = report.piles     || [];
  const drillings = report.drillings || [];
  const downtimes = report.downtimes || [];

  const totalPiles     = piles.reduce((s, p) => s + (p.count || 0), 0);
  const totalDrilling  = drillings.reduce((s, d) => s + (d.meters || 0), 0);
  const totalDowntime  = downtimes.reduce((s, d) => s + (d.duration || 0), 0);

  const hasAnyData = piles.length > 0 || drillings.length > 0 || downtimes.length > 0;

  const statusMap  = { submitted: 'Отправлен', draft: 'Черновик' };
  const shiftMap   = { DAY: 'Дневная', NIGHT: 'Ночная' };
  const editorRoleMap = { ADMIN: 'Администратор', DISPATCHER: 'Диспетчер', ASSISTANT: 'Помощник', OPERATOR: 'Оператор' };
  const statusText = statusMap[report.status] || report.status || '—';
  const shiftText  = shiftMap[report.shiftType] || report.shiftType || '—';
  const editorText = report.lastEditedByName
    ? `${editorRoleMap[report.lastEditedByRole] || 'Оператор'}: ${report.lastEditedByName}`
    : '—';

  // ── Start building ──
  addHeader(doc, report);
  addInfoGrid(doc, report, statusText, shiftText, editorText);

  if (hasAnyData) {
    if (piles.length > 0)     addPilesSection(doc, piles);
    if (drillings.length > 0) addDrillingsSection(doc, drillings);
    if (downtimes.length > 0) addDowntimesSection(doc, downtimes);
    addSummaryBox(doc, totalPiles, totalDrilling, totalDowntime);
  } else {
    addEmptyState(doc);
  }

  addFooter(doc, report);

  // ── Page numbers ──
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.font('Regular').fontSize(8).fillColor(CLR.textLight);
    doc.text(
      `${i + 1} / ${range.count}`,
      MARGIN_LEFT,
      PAGE_H - MARGIN_BOTTOM - 5,
      { width: CONTENT_W, align: 'right' }
    );
    doc.fillColor(CLR.text);
  }

  // ── Output PDF binary ──
  if (outputPath) {
    // Write to file (avoids binary encoding issues with stdout)
    const writeStream = fs.createWriteStream(outputPath);
    doc.pipe(writeStream);
    doc.end();
    writeStream.on('finish', () => {
      process.exit(0);
    });
    writeStream.on('error', (err) => {
      process.stderr.write(`Write error: ${err.message}\n`);
      process.exit(1);
    });
  } else {
    // Fallback: output to stdout
    const buffers = [];
    doc.on('data', (chunk) => buffers.push(chunk));
    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(buffers);
      process.stdout.write(pdfBuffer);
    });
    doc.end();
  }
}

// ═══════════════════════════════════════════════════════════
// HEADER SECTION
// ═══════════════════════════════════════════════════════════

function addHeader(doc, report) {
  let y = MARGIN_TOP + 5;

  // "PILINGTRACK" large bold
  doc.font('Bold').fontSize(22).fillColor(CLR.dark);
  doc.text('PILINGTRACK', MARGIN_LEFT, y, { width: CONTENT_W, align: 'center' });

  // Orange accent line
  y = doc.y + 4;
  const lineW = 160;
  const lineX = MARGIN_LEFT + (CONTENT_W - lineW) / 2;
  doc.rect(lineX, y, lineW, 3).fill(CLR.orange);
  y += 14;

  // Report title
  doc.font('Bold').fontSize(13).fillColor(CLR.dark);
  doc.text('РАБОЧИЙ ОТЧЁТ ПО СВАЙНЫМ РАБОТАМ', MARGIN_LEFT, y, { width: CONTENT_W, align: 'center' });

  // Report number and date
  y = doc.y + 6;
  doc.font('Regular').fontSize(9).fillColor(CLR.textLight);
  const shortId = (report.reportId || '—').substring(0, 8).toUpperCase();
  const dateStr = formatRuDate(report.date);
  doc.text(`№ ${shortId}  |  ${dateStr}`, MARGIN_LEFT, y, { width: CONTENT_W, align: 'center' });

  // Separator line
  y = doc.y + 8;
  doc.moveTo(MARGIN_LEFT, y).lineTo(MARGIN_LEFT + CONTENT_W, y).strokeColor(CLR.border).lineWidth(1).stroke();

  doc.y = y + 8;
  doc.x = MARGIN_LEFT;
  doc.fillColor(CLR.text);
}

// ═══════════════════════════════════════════════════════════
// INFO GRID (two-column table)
// ═══════════════════════════════════════════════════════════

function addInfoGrid(doc, report, statusText, shiftText, editorText) {
  // 4-column layout: label | value | label | value
  const lW = CONTENT_W * 0.18;  // label width
  const vW = CONTENT_W * 0.32;  // value width
  const rowH = 22;
  const rows = [
    ['Объект',      (report.site && report.site.name) || '—',       'Дата',       formatRuDate(report.date)],
    ['Оператор',    (report.user && report.user.name) || '—',       'Смена',      `${shiftText}  ${report.shiftStart || ''}–${report.shiftEnd || ''}`],
    ['Помощник',    report.assistantName || '—',                    'Оборудование', report.equipmentName || '—'],
    ['Статус',      statusText,                                        '',            ''],
    ['Последнее изменение', editorText, '', ''],
  ];

  let y = doc.y;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const isAlt = i % 2 === 1;

    // Row background
    doc.rect(MARGIN_LEFT, y, CONTENT_W, rowH).fill(isAlt ? CLR.rowAlt : CLR.rowWhite);

    // Cell borders
    doc.strokeColor(CLR.border).lineWidth(0.5);
    doc.rect(MARGIN_LEFT, y, CONTENT_W, rowH).stroke();
    // Vertical dividers: after left label, between halves, after right label
    const x1 = MARGIN_LEFT + lW;
    const x2 = MARGIN_LEFT + lW + vW;
    const x3 = MARGIN_LEFT + lW + vW + lW;
    doc.moveTo(x1, y).lineTo(x1, y + rowH).stroke();
    doc.moveTo(x2, y).lineTo(x2, y + rowH).stroke();
    doc.moveTo(x3, y).lineTo(x3, y + rowH).stroke();

    // Left label
    doc.font('Bold').fontSize(8).fillColor(CLR.textLight);
    doc.text(r[0], MARGIN_LEFT + 6, y + 6, { width: lW - 8, height: rowH });

    // Left value
    doc.font('Regular').fontSize(8.5).fillColor(CLR.dark);
    doc.text(r[1], x1 + 6, y + 6, { width: vW - 8, height: rowH });

    // Right label
    if (r[2]) {
      doc.font('Bold').fontSize(8).fillColor(CLR.textLight);
      doc.text(r[2], x2 + 6, y + 6, { width: lW - 8, height: rowH });
    }

    // Right value
    if (r[3]) {
      doc.font('Regular').fontSize(8.5).fillColor(CLR.dark);
      doc.text(r[3], x3 + 6, y + 6, { width: vW - 8, height: rowH });
    }

    y += rowH;
  }

  doc.x = MARGIN_LEFT;
  doc.y = y + 14;
}

// ═══════════════════════════════════════════════════════════
// SECTION HEADER HELPER
// ═══════════════════════════════════════════════════════════

function drawSectionHeader(doc, title) {
  let y = doc.y;

  // Orange left bar
  doc.rect(MARGIN_LEFT, y, 4, 18).fill(CLR.orange);

  // Title text
  doc.font('Bold').fontSize(11).fillColor(CLR.dark);
  doc.text(title, MARGIN_LEFT + 12, y + 2, { width: CONTENT_W - 12 });

  y = doc.y + 4;
  doc.x = MARGIN_LEFT;
  doc.y = y;
}

// ═══════════════════════════════════════════════════════════
// PROFESSIONAL TABLE
// ═══════════════════════════════════════════════════════════

function drawTable(doc, headers, rows, colWidths) {
  const headerH = 26;
  const rowH = 22;
  const totalRowH = 26;
  const padX = 6;
  const padY = 5;

  // Check if we need a new page for the header + at least one row
  if (doc.y + headerH + rowH > PAGE_H - MARGIN_BOTTOM) {
    doc.addPage();
  }

  let y = doc.y;

  // ── Header row ──
  doc.rect(MARGIN_LEFT, y, CONTENT_W, headerH).fill(CLR.headerBg);
  doc.strokeColor(CLR.border).lineWidth(0.5);
  doc.rect(MARGIN_LEFT, y, CONTENT_W, headerH).stroke();

  let x = MARGIN_LEFT;
  for (let i = 0; i < headers.length; i++) {
    if (i > 0) {
      doc.moveTo(x, y).lineTo(x, y + headerH).stroke();
    }
    doc.font('Bold').fontSize(8.5).fillColor(CLR.text);
    doc.text(headers[i], x + padX, y + padY, { width: colWidths[i] - padX * 2, height: headerH });
    x += colWidths[i];
  }
  y += headerH;

  // ── Data rows ──
  for (let i = 0; i < rows.length; i++) {
    if (y + rowH > PAGE_H - MARGIN_BOTTOM) {
      doc.addPage();
      y = MARGIN_TOP;

      // Repeat header on new page
      doc.rect(MARGIN_LEFT, y, CONTENT_W, headerH).fill(CLR.headerBg);
      doc.strokeColor(CLR.border).lineWidth(0.5);
      doc.rect(MARGIN_LEFT, y, CONTENT_W, headerH).stroke();
      let hx = MARGIN_LEFT;
      for (let j = 0; j < headers.length; j++) {
        if (j > 0) doc.moveTo(hx, y).lineTo(hx, y + headerH).stroke();
        doc.font('Bold').fontSize(8.5).fillColor(CLR.text);
        doc.text(headers[j], hx + padX, y + padY, { width: colWidths[j] - padX * 2, height: headerH });
        hx += colWidths[j];
      }
      y += headerH;
    }

    const isAlt = i % 2 === 1;
    doc.rect(MARGIN_LEFT, y, CONTENT_W, rowH).fill(isAlt ? CLR.rowAlt : CLR.rowWhite);
    doc.strokeColor(CLR.border).lineWidth(0.5);
    doc.rect(MARGIN_LEFT, y, CONTENT_W, rowH).stroke();

    let cx = MARGIN_LEFT;
    for (let j = 0; j < rows[i].length; j++) {
      if (j > 0) doc.moveTo(cx, y).lineTo(cx, y + rowH).stroke();
      const isLast = j === rows[i].length - 1;
      doc.font(isLast ? 'Bold' : 'Regular').fontSize(9).fillColor(CLR.dark);
      doc.text(String(rows[i][j] || ''), cx + padX, y + padY, {
        width: colWidths[j] - padX * 2,
        height: rowH,
        lineBreak: false,
        ellipsis: true,
      });
      cx += colWidths[j];
    }
    y += rowH;
  }

  // ── Total row ──
  if (y + totalRowH > PAGE_H - MARGIN_BOTTOM) {
    doc.addPage();
    y = MARGIN_TOP;
  }

  doc.rect(MARGIN_LEFT, y, CONTENT_W, totalRowH).fill(CLR.totalBg);
  doc.strokeColor(CLR.border).lineWidth(0.5);
  doc.rect(MARGIN_LEFT, y, CONTENT_W, totalRowH).stroke();

  doc.x = MARGIN_LEFT;
  doc.y = y + totalRowH + 6;
}

// ═══════════════════════════════════════════════════════════
// PILES SECTION
// ═══════════════════════════════════════════════════════════

function addPilesSection(doc, piles) {
  drawSectionHeader(doc, 'ЗАБИТЫЕ СВАИ');

  const headers  = ['№', 'Марка сваи', 'Количество, шт'];
  const numW     = 35;
  const colWidths = [numW, CONTENT_W - numW - 90, 90];

  const rows = piles.map((p, i) => [
    String(i + 1),
    (p.pileGrade && p.pileGrade.name) || '—',
    String(p.count || 0),
  ]);

  const total = piles.reduce((s, p) => s + (p.count || 0), 0);
  rows.push(['', 'ИТОГО', String(total)]);

  drawTable(doc, headers, rows, colWidths);
  doc.x = MARGIN_LEFT;
  doc.y += 2;
}

// ═══════════════════════════════════════════════════════════
// DRILLINGS SECTION
// ═══════════════════════════════════════════════════════════

function addDrillingsSection(doc, drillings) {
  drawSectionHeader(doc, 'ЛИДЕРНОЕ БУРЕНИЕ');

  const headers   = ['№', 'Тип бурения', 'Метры'];
  const numW      = 35;
  const colWidths = [numW, CONTENT_W - numW - 90, 90];

  const rows = drillings.map((d, i) => [
    String(i + 1),
    (d.type && d.type.name) || '—',
    String((d.meters || 0)),
  ]);

  const total = drillings.reduce((s, d) => s + (d.meters || 0), 0);
  rows.push(['', 'ИТОГО', String(total)]);

  drawTable(doc, headers, rows, colWidths);
  doc.x = MARGIN_LEFT;
  doc.y += 2;
}

// ═══════════════════════════════════════════════════════════
// DOWNTIMES SECTION
// ═══════════════════════════════════════════════════════════

function addDowntimesSection(doc, downtimes) {
  drawSectionHeader(doc, 'ПРОСТОИ ТЕХНИКИ');

  const headers   = ['№', 'Причина', 'Длительность, ч', 'Комментарий'];
  const numW      = 35;
  const reasonW   = 140;
  const durW      = 90;
  const commentW  = CONTENT_W - numW - reasonW - durW;
  const colWidths = [numW, reasonW, durW, commentW];

  const rows = downtimes.map((d, i) => [
    String(i + 1),
    (d.reason && d.reason.name) || '—',
    String(d.duration || 0),
    d.comment || '—',
  ]);

  const total = downtimes.reduce((s, d) => s + (d.duration || 0), 0);
  rows.push(['', 'ИТОГО', String(total), '']);

  drawTable(doc, headers, rows, colWidths);
  doc.x = MARGIN_LEFT;
  doc.y += 2;
}

// ═══════════════════════════════════════════════════════════
// SUMMARY BOX
// ═══════════════════════════════════════════════════════════

function addSummaryBox(doc, totalPiles, totalDrilling, totalDowntime) {
  const boxH = 56;
  const padTop = 8;

  // Check page break
  if (doc.y + boxH + 20 > PAGE_H - MARGIN_BOTTOM) {
    doc.addPage();
  }

  let y = doc.y;

  // Background
  doc.rect(MARGIN_LEFT, y, CONTENT_W, boxH).fill(CLR.summaryBg);
  // Border
  doc.strokeColor(CLR.orange).lineWidth(1.5);
  doc.rect(MARGIN_LEFT, y, CONTENT_W, boxH).stroke();

  // Title
  doc.font('Bold').fontSize(9).fillColor(CLR.textLight);
  doc.text('ИТОГО ЗА ОТЧЁТНЫЙ ПЕРИОД:', MARGIN_LEFT + 14, y + padTop, { width: CONTENT_W - 28 });

  // Metrics row
  const metricY = y + padTop + 16;
  const metricW = CONTENT_W / 3;

  // Piles
  doc.font('Regular').fontSize(9).fillColor(CLR.text);
  doc.text('Сваи забито:', MARGIN_LEFT + 20, metricY, { width: metricW - 24 });
  doc.font('Bold').fontSize(13).fillColor(CLR.orange);
  doc.text(`${totalPiles} шт.`, MARGIN_LEFT + 20, metricY + 12, { width: metricW - 24 });

  // Drilling
  doc.font('Regular').fontSize(9).fillColor(CLR.text);
  doc.text('Бурение:', MARGIN_LEFT + metricW + 16, metricY, { width: metricW - 24 });
  doc.font('Bold').fontSize(13).fillColor(CLR.orange);
  doc.text(`${totalDrilling} м`, MARGIN_LEFT + metricW + 16, metricY + 12, { width: metricW - 24 });

  // Downtime
  doc.font('Regular').fontSize(9).fillColor(CLR.text);
  doc.text('Простои:', MARGIN_LEFT + metricW * 2 + 12, metricY, { width: metricW - 24 });
  doc.font('Bold').fontSize(13).fillColor(CLR.orange);
  doc.text(`${totalDowntime} ч`, MARGIN_LEFT + metricW * 2 + 12, metricY + 12, { width: metricW - 24 });

  doc.x = MARGIN_LEFT;
  doc.y = y + boxH + 14;
  doc.fillColor(CLR.text);
}

// ═══════════════════════════════════════════════════════════
// EMPTY STATE
// ═══════════════════════════════════════════════════════════

function addEmptyState(doc) {
  let y = doc.y + 10;
  const boxH = 50;
  doc.rect(MARGIN_LEFT, y, CONTENT_W, boxH).fill(CLR.headerBg);
  doc.strokeColor(CLR.border).lineWidth(0.5);
  doc.rect(MARGIN_LEFT, y, CONTENT_W, boxH).stroke();

  doc.font('Regular').fontSize(10).fillColor(CLR.textLight);
  doc.text('Нет данных по работе за указанный период', MARGIN_LEFT, y + 16, { width: CONTENT_W, align: 'center' });

  doc.x = MARGIN_LEFT;
  doc.y = y + boxH + 20;
  doc.fillColor(CLR.text);
}

// ═══════════════════════════════════════════════════════════
// FOOTER SECTION
// ═══════════════════════════════════════════════════════════

function addFooter(doc, report) {
  // Need space for footer: ~80pt
  const footerNeeded = 82;
  if (doc.y + footerNeeded > PAGE_H - MARGIN_BOTTOM) {
    doc.addPage();
  }

  let y = doc.y + 6;

  // Separator
  doc.moveTo(MARGIN_LEFT, y).lineTo(MARGIN_LEFT + CONTENT_W, y).strokeColor(CLR.border).lineWidth(0.5).stroke();
  y += 12;

  // Signature lines - two columns
  const colW = CONTENT_W / 2;
  const lineW = 150;
  const operatorName = (report.user && report.user.name) || '________________';
  const line1X = MARGIN_LEFT;
  const line2X = MARGIN_LEFT + colW;

  doc.font('Regular').fontSize(9).fillColor(CLR.text);
  doc.text('Оператор', line1X, y);
  doc.moveTo(line1X + 52, y + 22).lineTo(line1X + 52 + lineW, y + 22).strokeColor(CLR.text).lineWidth(0.5).stroke();
  doc.text(`/ ${operatorName} /`, line1X + 52, y + 26, { width: lineW });
  doc.fillColor(CLR.text);

  doc.font('Regular').fontSize(9).fillColor(CLR.text);
  doc.text('Мастер', line2X, y);
  doc.moveTo(line2X + 42, y + 22).lineTo(line2X + 42 + lineW, y + 22).strokeColor(CLR.text).lineWidth(0.5).stroke();
  doc.text('/ _______________ /', line2X + 42, y + 26, { width: lineW });
  doc.fillColor(CLR.text);

  y += 46;

  // Date generated
  const now = new Date();
  const genDate = now.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  const genTime = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  doc.font('Oblique').fontSize(8).fillColor(CLR.textLight);
  doc.text(`Отчёт сформирован: ${genDate} в ${genTime}`, MARGIN_LEFT, y, { width: CONTENT_W, align: 'center' });

  doc.fillColor(CLR.text);
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════

function formatRuDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return String(dateStr);
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}
