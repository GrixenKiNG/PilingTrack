#!/usr/bin/env node
// Standalone period-report PDF generator — professional template
// Used by /api/reports/pdf via child_process
// Input: JSON file path as first argument — { dateFrom, dateTo, siteId, reports[], totalPiles, totalDrilling, totalDowntime }

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
  greenBg:      '#ecfdf5',
  greenText:    '#16a34a',
  grayBg:       '#f1f5f9',
  grayText:     '#64748b',
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
  process.stderr.write('Usage: generate-pdf.js <input.json> [output.pdf]\n');
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

try {
  generatePdf(data);
} catch (err) {
  process.stderr.write(`Generation error: ${err.message}\n${err.stack}\n`);
  process.exit(1);
}

// ═══════════════════════════════════════════════════════════
// MAIN GENERATION
// ═══════════════════════════════════════════════════════════

function generatePdf(data) {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 0,
    bufferPages: true,
  });

  // Register all fonts
  for (const [name, p] of Object.entries(FONT)) {
    doc.registerFont(name, p);
  }

  const reports = data.reports || [];
  const totalPiles    = data.totalPiles    || 0;
  const totalDrilling = data.totalDrilling || 0;
  const totalDowntime = data.totalDowntime || 0;

  // ── Build header ──
  addHeader(doc, data);

  if (reports.length === 0) {
    addEmptyState(doc);
  } else {
    // ── Summary box ──
    addSummaryBox(doc, reports.length, totalPiles, totalDrilling, totalDowntime);

    // ── Detail table ──
    addDetailTable(doc, reports);

    // ── Per-report breakdowns ──
    addReportBreakdowns(doc, reports);
  }

  // ── Footer ──
  addFooter(doc);

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

function addHeader(doc, data) {
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

  // Title
  doc.font('Bold').fontSize(13).fillColor(CLR.dark);
  doc.text('СВОДНЫЙ ОТЧЁТ ЗА ПЕРИОД', MARGIN_LEFT, y, { width: CONTENT_W, align: 'center' });

  // Period dates
  y = doc.y + 6;
  doc.font('Regular').fontSize(9).fillColor(CLR.textLight);
  const fromDate = formatRuDate(data.dateFrom);
  const toDate = formatRuDate(data.dateTo);
  doc.text(`${fromDate} — ${toDate}`, MARGIN_LEFT, y, { width: CONTENT_W, align: 'center' });

  // Site name if siteId present
  if (data.siteId) {
    const reports = data.reports || [];
    const siteName = (reports[0] && reports[0].site && reports[0].site.name) || '';
    if (siteName) {
      y = doc.y + 3;
      doc.font('Regular').fontSize(9).fillColor(CLR.text);
      doc.text(`Объект: ${siteName}`, MARGIN_LEFT, y, { width: CONTENT_W, align: 'center' });
    }
  }

  // Separator line
  y = doc.y + 10;
  doc.moveTo(MARGIN_LEFT, y).lineTo(MARGIN_LEFT + CONTENT_W, y).strokeColor(CLR.border).lineWidth(1).stroke();

  doc.y = y + 10;
  doc.x = MARGIN_LEFT;
  doc.fillColor(CLR.text);
}

// ═══════════════════════════════════════════════════════════
// SUMMARY BOX
// ═══════════════════════════════════════════════════════════

function addSummaryBox(doc, reportCount, totalPiles, totalDrilling, totalDowntime) {
  const boxH = 80;
  const padTop = 8;

  // Check page break
  if (doc.y + boxH + 20 > PAGE_H - MARGIN_BOTTOM) {
    doc.addPage();
  }

  let y = doc.y;

  // Background
  doc.rect(MARGIN_LEFT, y, CONTENT_W, boxH).fill(CLR.summaryBg);

  // Orange accent on top
  doc.rect(MARGIN_LEFT, y, CONTENT_W, 3).fill(CLR.orange);

  // Border
  doc.strokeColor(CLR.border).lineWidth(0.5);
  doc.rect(MARGIN_LEFT, y, CONTENT_W, boxH).stroke();

  // Title
  doc.font('Bold').fontSize(9).fillColor(CLR.textLight);
  doc.text('СВОДНЫЕ ПОКАЗАТЕЛИ:', MARGIN_LEFT + 14, y + padTop + 4, { width: CONTENT_W - 28 });

  // Metrics — 4 columns
  const metricY = y + padTop + 20;
  const colW = CONTENT_W / 4;

  const metrics = [
    { label: 'Отчётов', value: String(reportCount), unit: 'шт' },
    { label: 'Свай забито', value: String(totalPiles), unit: 'шт' },
    { label: 'Бурение', value: String(totalDrilling % 1 === 0 ? totalDrilling : totalDrilling.toFixed(1)), unit: 'м' },
    { label: 'Простои', value: String(totalDowntime % 1 === 0 ? totalDowntime : totalDowntime.toFixed(1)), unit: 'ч' },
  ];

  metrics.forEach((m, i) => {
    const cx = MARGIN_LEFT + colW * i;

    // Label
    doc.font('Regular').fontSize(8).fillColor(CLR.textLight);
    doc.text(m.label, cx + 12, metricY, { width: colW - 24 });

    // Value (bold, larger)
    doc.font('Bold').fontSize(16).fillColor(CLR.dark);
    doc.text(m.value, cx + 12, metricY + 14, { width: colW - 24 });

    // Unit
    const valW = doc.widthOfString(m.value);
    doc.font('Regular').fontSize(8).fillColor(CLR.textLight);
    doc.text(m.unit, cx + 14 + valW, metricY + 22, { width: colW - 24 });
  });

  doc.x = MARGIN_LEFT;
  doc.y = y + boxH + 14;
  doc.fillColor(CLR.text);
}

// ═══════════════════════════════════════════════════════════
// SECTION HEADER HELPER
// ═══════════════════════════════════════════════════════════

function drawSectionHeader(doc, title) {
  let y = doc.y;

  // Check page break
  if (y + 24 > PAGE_H - MARGIN_BOTTOM) {
    doc.addPage();
    y = doc.y;
  }

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
// DETAIL TABLE
// ═══════════════════════════════════════════════════════════

function addDetailTable(doc, reports) {
  drawSectionHeader(doc, 'ДЕТАЛИЗАЦИЯ ПО ОТЧЁТАМ');

  // Column widths: № | Дата | Оператор | Помощник | Оборудование | Сваи, шт | Бурение, м | Простой, ч | Статус
  const colDefs = [
    { w: 22,  align: 'center' },  // №
    { w: 62,  align: 'center' },  // Дата
    { w: 82,  align: 'left' },    // Оператор
    { w: 68,  align: 'left' },    // Помощник
    { w: 78,  align: 'left' },    // Оборудование
    { w: 50,  align: 'center' },  // Сваи
    { w: 58,  align: 'center' },  // Бурение
    { w: 50,  align: 'center' },  // Простой
    { w: 72,  align: 'center' },  // Статус
  ];

  // Scale to fit CONTENT_W
  const totalDefW = colDefs.reduce((s, c) => s + c.w, 0);
  const scale = CONTENT_W / totalDefW;
  const colWidths = colDefs.map(c => c.w * scale);

  const headers = ['№', 'Дата', 'Оператор', 'Помощник', 'Оборудование', 'Сваи, шт', 'Бурение, м', 'Простой, ч', 'Статус'];

  // Build rows
  const rows = reports.map((r, i) => {
    const rPiles    = (r.piles || []).reduce((s, p) => s + (p.count || 0), 0);
    const rDrilling = (r.drillings || []).reduce((s, d) => s + (d.meters || 0), 0);
    const rDowntime = (r.downtimes || []).reduce((s, d) => s + (d.duration || 0), 0);

    return {
      num: String(i + 1),
      date: formatRuDateShort(r.date),
      operator: (r.user && r.user.name) || '—',
      crew: r.assistantName || ((r.crew && r.crew.assistants && r.crew.assistants.map((a) => a.name).join(', ')) || '—'),
      equipment: r.equipmentName || (r.equipment && r.equipment.name) || (r.crew && r.crew.equipment && r.crew.equipment.name) || '—',
      piles: String(rPiles),
      drilling: String(rDrilling.toFixed(1)),
      downtime: rDowntime > 0 ? String(rDowntime.toFixed(1)) : '—',
      status: r.status === 'submitted' ? 'Отправлен' : 'Черновик',
      statusType: r.status === 'submitted' ? 'green' : 'gray',
    };
  });

  drawPeriodTable(doc, headers, rows, colWidths, colDefs);
  doc.x = MARGIN_LEFT;
  doc.y += 6;
}

function drawPeriodTable(doc, headers, rows, colWidths, colDefs) {
  const headerH = 26;
  const rowH = 24;
  const padX = 5;
  const padY = 6;

  // Check if we need a new page for the header + at least one row
  if (doc.y + headerH + rowH > PAGE_H - MARGIN_BOTTOM) {
    doc.addPage();
  }

  let y = doc.y;

  // ── Draw table header ──
  y = drawTableHeader(doc, headers, colWidths, y, headerH, padX, padY);

  // ── Data rows ──
  for (let i = 0; i < rows.length; i++) {
    if (y + rowH > PAGE_H - MARGIN_BOTTOM - 30) {
      doc.addPage();
      y = MARGIN_TOP;
      // Repeat header on new page
      y = drawTableHeader(doc, headers, colWidths, y, headerH, padX, padY);
    }

    const isAlt = i % 2 === 1;
    const r = rows[i];
    const cells = [r.num, r.date, r.operator, r.crew, r.equipment, r.piles, r.drilling, r.downtime, r.status];

    // Row background
    doc.rect(MARGIN_LEFT, y, CONTENT_W, rowH).fill(isAlt ? CLR.rowAlt : CLR.rowWhite);

    // Borders
    doc.strokeColor(CLR.border).lineWidth(0.5);
    doc.rect(MARGIN_LEFT, y, CONTENT_W, rowH).stroke();

    // Cell content
    let x = MARGIN_LEFT;
    for (let j = 0; j < cells.length; j++) {
      if (j > 0) {
        doc.moveTo(x, y).lineTo(x, y + rowH).stroke();
      }

      const align = colDefs[j].align || 'left';
      const cellX = align === 'center' ? x : x + padX;

      // Special styling for status column (last)
      if (j === cells.length - 1) {
        drawStatusBadge(doc, cells[j], r.statusType, x, y, colWidths[j], rowH);
      } else if (j === 0) {
        // Row number — smaller, gray
        doc.font('Regular').fontSize(8).fillColor(CLR.textLight);
        doc.text(cells[j], cellX, y + padY + 1, {
          width: colWidths[j] - padX * 2,
          height: rowH,
          align: 'center',
          lineBreak: false,
        });
      } else {
        doc.font('Regular').fontSize(8).fillColor(CLR.dark);
        doc.text(cells[j], cellX, y + padY, {
          width: colWidths[j] - padX * 2,
          height: rowH,
          lineBreak: false,
          ellipsis: true,
        });
      }

      x += colWidths[j];
    }
    y += rowH;
  }

  doc.x = MARGIN_LEFT;
  doc.y = y;
}

function drawTableHeader(doc, headers, colWidths, y, headerH, padX, padY) {
  // Header background
  doc.rect(MARGIN_LEFT, y, CONTENT_W, headerH).fill(CLR.headerBg);
  doc.strokeColor(CLR.border).lineWidth(0.5);
  doc.rect(MARGIN_LEFT, y, CONTENT_W, headerH).stroke();

  // Header cells
  let x = MARGIN_LEFT;
  for (let i = 0; i < headers.length; i++) {
    if (i > 0) {
      doc.moveTo(x, y).lineTo(x, y + headerH).stroke();
    }
    doc.font('Bold').fontSize(7.5).fillColor(CLR.text);
    doc.text(headers[i], x + padX, y + padY, {
      width: colWidths[i] - padX * 2,
      height: headerH,
      lineBreak: false,
      ellipsis: true,
    });
    x += colWidths[i];
  }
  return y + headerH;
}

function drawStatusBadge(doc, text, type, x, y, w, h) {
  const padX = 6;
  const padY = 4;
  const badgeH = 16;
  const badgeY = y + (h - badgeH) / 2;

  // Measure text width
  doc.font('Bold').fontSize(7);
  const textW = doc.widthOfString(text);
  const badgeW = Math.min(textW + padX * 2, w - 8);
  const badgeX = x + (w - badgeW) / 2;

  if (type === 'green') {
    doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 3).fill(CLR.greenBg);
    doc.font('Bold').fontSize(7).fillColor(CLR.greenText);
  } else {
    doc.roundedRect(badgeX, badgeY, badgeW, badgeH, 3).fill(CLR.grayBg);
    doc.font('Bold').fontSize(7).fillColor(CLR.grayText);
  }
  doc.text(text, badgeX, badgeY + 4, { width: badgeW, align: 'center', lineBreak: false });
}

// ═══════════════════════════════════════════════════════════
// PER-REPORT BREAKDOWN SECTIONS
// ═══════════════════════════════════════════════════════════

function addReportBreakdowns(doc, reports) {
  // Only add breakdowns if we have enough space (not too many reports)
  // Skip if there are more than 8 reports — the detail table is already sufficient
  if (reports.length > 8) return;

  const now = new Date();
  let hasSpace = true;

  // Estimate remaining space on current page
  // We need at least ~200pt for the smallest breakdown section
  if (doc.y + 200 > PAGE_H - MARGIN_BOTTOM) {
    doc.addPage();
  }

  // Check if we have room for at least one section after adding the heading
  // (heading takes ~30pt, smallest section ~100pt)
  if (doc.y + 180 > PAGE_H - MARGIN_BOTTOM) {
    hasSpace = false;
  }

  if (!hasSpace) return;

  for (const report of reports) {
    const piles     = report.piles     || [];
    const drillings = report.drillings || [];
    const downtimes = report.downtimes || [];

    // Skip reports with no detailed data
    if (piles.length === 0 && drillings.length === 0 && downtimes.length === 0) continue;

    const operatorName = (report.user && report.user.name) || '—';
    const reportDate   = formatRuDateShort(report.date);
    const crewName     = (report.crew && report.crew.name) || '—';
    const equipName    = (report.crew && report.crew.equipment && report.crew.equipment.name) || '—';

    // Estimate section height
    const sectionLines = 3 + piles.length + drillings.length + downtimes.length;
    const estH = 40 + sectionLines * 18;

    // Page break check
    if (doc.y + estH > PAGE_H - MARGIN_BOTTOM) {
      doc.addPage();
    }

    // ── Sub-header ──
    let y = doc.y + 4;

    // Orange left bar
    doc.rect(MARGIN_LEFT, y, 3, 14).fill(CLR.orange);

    // Report header text
    doc.font('Bold').fontSize(9).fillColor(CLR.dark);
    doc.text(`${reportDate}  ·  ${operatorName}`, MARGIN_LEFT + 10, y + 1, { width: CONTENT_W - 10 });

    // Sub-details line
    y = doc.y + 2;
    doc.font('Regular').fontSize(8).fillColor(CLR.textLight);
    doc.text(`${crewName}${equipName !== '—' ? '  |  ' + equipName : ''}`, MARGIN_LEFT + 10, y, { width: CONTENT_W - 10 });

    y = doc.y + 6;

    // ── Mini piles table ──
    if (piles.length > 0) {
      const tableH = 18 + piles.length * 16 + 2;
      if (y + tableH > PAGE_H - MARGIN_BOTTOM) {
        doc.addPage();
        y = doc.y;
      }

      const numW = 22;
      const nameW = CONTENT_W - numW - 80;
      const cntW = 80;
      const cws = [numW, nameW, cntW];

      // Header row
      doc.rect(MARGIN_LEFT, y, CONTENT_W, 16).fill(CLR.headerBg);
      doc.strokeColor(CLR.border).lineWidth(0.3);
      doc.rect(MARGIN_LEFT, y, CONTENT_W, 16).stroke();
      doc.moveTo(MARGIN_LEFT + numW, y).lineTo(MARGIN_LEFT + numW, y + 16).stroke();
      doc.moveTo(MARGIN_LEFT + numW + nameW, y).lineTo(MARGIN_LEFT + numW + nameW, y + 16).stroke();

      doc.font('Bold').fontSize(7).fillColor(CLR.textLight);
      doc.text('№', MARGIN_LEFT + 4, y + 4, { width: numW - 6, align: 'center', lineBreak: false });
      doc.text('Марка сваи', MARGIN_LEFT + numW + 4, y + 4, { width: nameW - 8, lineBreak: false });
      doc.text('Кол-во, шт', MARGIN_LEFT + numW + nameW + 4, y + 4, { width: cntW - 8, align: 'center', lineBreak: false });
      y += 16;

      for (let i = 0; i < piles.length; i++) {
        const isAlt = i % 2 === 1;
        doc.rect(MARGIN_LEFT, y, CONTENT_W, 16).fill(isAlt ? CLR.rowAlt : CLR.rowWhite);
        doc.strokeColor(CLR.border).lineWidth(0.3);
        doc.rect(MARGIN_LEFT, y, CONTENT_W, 16).stroke();
        doc.moveTo(MARGIN_LEFT + numW, y).lineTo(MARGIN_LEFT + numW, y + 16).stroke();
        doc.moveTo(MARGIN_LEFT + numW + nameW, y).lineTo(MARGIN_LEFT + numW + nameW, y + 16).stroke();

        doc.font('Regular').fontSize(7.5).fillColor(CLR.textLight);
        doc.text(String(i + 1), MARGIN_LEFT + 4, y + 4, { width: numW - 6, align: 'center', lineBreak: false });
        doc.font('Regular').fontSize(7.5).fillColor(CLR.dark);
        doc.text((piles[i].pileGrade && piles[i].pileGrade.name) || '—', MARGIN_LEFT + numW + 4, y + 4, { width: nameW - 8, lineBreak: false, ellipsis: true });
        doc.font('Bold').fontSize(7.5).fillColor(CLR.dark);
        doc.text(String(piles[i].count || 0), MARGIN_LEFT + numW + nameW + 4, y + 4, { width: cntW - 8, align: 'center', lineBreak: false });
        y += 16;
      }
      y += 4;
    }

    // ── Mini drillings table ──
    if (drillings.length > 0) {
      const tableH = 18 + drillings.length * 16 + 2;
      if (y + tableH > PAGE_H - MARGIN_BOTTOM) {
        doc.addPage();
        y = doc.y;
      }

      const numW = 22;
      const nameW = CONTENT_W - numW - 80;
      const mtrW = 80;
      const cws = [numW, nameW, mtrW];

      doc.rect(MARGIN_LEFT, y, CONTENT_W, 16).fill(CLR.headerBg);
      doc.strokeColor(CLR.border).lineWidth(0.3);
      doc.rect(MARGIN_LEFT, y, CONTENT_W, 16).stroke();
      doc.moveTo(MARGIN_LEFT + numW, y).lineTo(MARGIN_LEFT + numW, y + 16).stroke();
      doc.moveTo(MARGIN_LEFT + numW + nameW, y).lineTo(MARGIN_LEFT + numW + nameW, y + 16).stroke();

      doc.font('Bold').fontSize(7).fillColor(CLR.textLight);
      doc.text('№', MARGIN_LEFT + 4, y + 4, { width: numW - 6, align: 'center', lineBreak: false });
      doc.text('Тип бурения', MARGIN_LEFT + numW + 4, y + 4, { width: nameW - 8, lineBreak: false });
      doc.text('Метры', MARGIN_LEFT + numW + nameW + 4, y + 4, { width: mtrW - 8, align: 'center', lineBreak: false });
      y += 16;

      for (let i = 0; i < drillings.length; i++) {
        const isAlt = i % 2 === 1;
        doc.rect(MARGIN_LEFT, y, CONTENT_W, 16).fill(isAlt ? CLR.rowAlt : CLR.rowWhite);
        doc.strokeColor(CLR.border).lineWidth(0.3);
        doc.rect(MARGIN_LEFT, y, CONTENT_W, 16).stroke();
        doc.moveTo(MARGIN_LEFT + numW, y).lineTo(MARGIN_LEFT + numW, y + 16).stroke();
        doc.moveTo(MARGIN_LEFT + numW + nameW, y).lineTo(MARGIN_LEFT + numW + nameW, y + 16).stroke();

        doc.font('Regular').fontSize(7.5).fillColor(CLR.textLight);
        doc.text(String(i + 1), MARGIN_LEFT + 4, y + 4, { width: numW - 6, align: 'center', lineBreak: false });
        doc.font('Regular').fontSize(7.5).fillColor(CLR.dark);
        doc.text((drillings[i].type && drillings[i].type.name) || '—', MARGIN_LEFT + numW + 4, y + 4, { width: nameW - 8, lineBreak: false, ellipsis: true });
        doc.font('Bold').fontSize(7.5).fillColor(CLR.dark);
        doc.text(String(drillings[i].meters || 0), MARGIN_LEFT + numW + nameW + 4, y + 4, { width: mtrW - 8, align: 'center', lineBreak: false });
        y += 16;
      }
      y += 4;
    }

    // ── Mini downtimes table ──
    if (downtimes.length > 0) {
      const tableH = 18 + downtimes.length * 16 + 2;
      if (y + tableH > PAGE_H - MARGIN_BOTTOM) {
        doc.addPage();
        y = doc.y;
      }

      const numW = 22;
      const reasonW = 140;
      const durW = 70;
      const commentW = CONTENT_W - numW - reasonW - durW;
      const cws = [numW, reasonW, durW, commentW];

      doc.rect(MARGIN_LEFT, y, CONTENT_W, 16).fill(CLR.headerBg);
      doc.strokeColor(CLR.border).lineWidth(0.3);
      doc.rect(MARGIN_LEFT, y, CONTENT_W, 16).stroke();

      let dx = MARGIN_LEFT + numW;
      doc.moveTo(dx, y).lineTo(dx, y + 16).stroke();
      dx += reasonW;
      doc.moveTo(dx, y).lineTo(dx, y + 16).stroke();
      dx += durW;
      doc.moveTo(dx, y).lineTo(dx, y + 16).stroke();

      doc.font('Bold').fontSize(7).fillColor(CLR.textLight);
      doc.text('№', MARGIN_LEFT + 4, y + 4, { width: numW - 6, align: 'center', lineBreak: false });
      doc.text('Причина', MARGIN_LEFT + numW + 4, y + 4, { width: reasonW - 8, lineBreak: false });
      doc.text('Часы', MARGIN_LEFT + numW + reasonW + 4, y + 4, { width: durW - 8, align: 'center', lineBreak: false });
      doc.text('Комментарий', MARGIN_LEFT + numW + reasonW + durW + 4, y + 4, { width: commentW - 8, lineBreak: false });
      y += 16;

      for (let i = 0; i < downtimes.length; i++) {
        const isAlt = i % 2 === 1;
        doc.rect(MARGIN_LEFT, y, CONTENT_W, 16).fill(isAlt ? CLR.rowAlt : CLR.rowWhite);
        doc.strokeColor(CLR.border).lineWidth(0.3);
        doc.rect(MARGIN_LEFT, y, CONTENT_W, 16).stroke();

        dx = MARGIN_LEFT + numW;
        doc.moveTo(dx, y).lineTo(dx, y + 16).stroke();
        dx += reasonW;
        doc.moveTo(dx, y).lineTo(dx, y + 16).stroke();
        dx += durW;
        doc.moveTo(dx, y).lineTo(dx, y + 16).stroke();

        doc.font('Regular').fontSize(7.5).fillColor(CLR.textLight);
        doc.text(String(i + 1), MARGIN_LEFT + 4, y + 4, { width: numW - 6, align: 'center', lineBreak: false });
        doc.font('Regular').fontSize(7.5).fillColor(CLR.dark);
        doc.text((downtimes[i].reason && downtimes[i].reason.name) || '—', MARGIN_LEFT + numW + 4, y + 4, { width: reasonW - 8, lineBreak: false, ellipsis: true });
        doc.font('Bold').fontSize(7.5).fillColor(CLR.dark);
        doc.text(String(downtimes[i].duration || 0), MARGIN_LEFT + numW + reasonW + 4, y + 4, { width: durW - 8, align: 'center', lineBreak: false });
        doc.font('Regular').fontSize(7.5).fillColor(CLR.text);
        doc.text(downtimes[i].comment || '—', MARGIN_LEFT + numW + reasonW + durW + 4, y + 4, { width: commentW - 8, lineBreak: false, ellipsis: true });
        y += 16;
      }
    }

    // Separator between reports
    y += 4;
    doc.moveTo(MARGIN_LEFT + 10, y).lineTo(MARGIN_LEFT + CONTENT_W - 10, y).strokeColor(CLR.border).lineWidth(0.3).stroke();
    y += 8;

    doc.x = MARGIN_LEFT;
    doc.y = y;
  }
}

// ═══════════════════════════════════════════════════════════
// EMPTY STATE
// ═══════════════════════════════════════════════════════════

function addEmptyState(doc) {
  let y = doc.y + 20;
  const boxH = 60;
  doc.rect(MARGIN_LEFT, y, CONTENT_W, boxH).fill(CLR.headerBg);
  doc.strokeColor(CLR.border).lineWidth(0.5);
  doc.rect(MARGIN_LEFT, y, CONTENT_W, boxH).stroke();

  doc.font('Regular').fontSize(11).fillColor(CLR.textLight);
  doc.text('Нет данных за указанный период', MARGIN_LEFT, y + 22, { width: CONTENT_W, align: 'center' });

  doc.x = MARGIN_LEFT;
  doc.y = y + boxH + 20;
  doc.fillColor(CLR.text);
}

// ═══════════════════════════════════════════════════════════
// FOOTER SECTION
// ═══════════════════════════════════════════════════════════

function addFooter(doc) {
  // Need space for footer: ~60pt
  const footerNeeded = 60;
  if (doc.y + footerNeeded > PAGE_H - MARGIN_BOTTOM) {
    doc.addPage();
  }

  let y = doc.y + 6;

  // Separator
  doc.moveTo(MARGIN_LEFT, y).lineTo(MARGIN_LEFT + CONTENT_W, y).strokeColor(CLR.border).lineWidth(0.5).stroke();
  y += 14;

  // Date generated — oblique
  const now = new Date();
  const genDate = now.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  const genTime = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  doc.font('Oblique').fontSize(8).fillColor(CLR.textLight);
  doc.text(`Сформировано: ${genDate} в ${genTime}`, MARGIN_LEFT, y, { width: CONTENT_W, align: 'center' });

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

function formatRuDateShort(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return String(dateStr);
  const day = d.getDate();
  const month = d.toLocaleDateString('ru-RU', { month: 'short' });
  return `${day} ${month}`;
}
