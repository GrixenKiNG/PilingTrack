import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import PDFDocument from 'pdfkit';

import {
  orionEquipmentProfiles,
  type OrionEquipmentProfile,
} from '../src/components/orion/orion-equipment-profiles';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REGULAR_FONT = path.join(ROOT, 'public', 'fonts', 'DejaVuSans.ttf');
const BOLD_FONT = path.join(ROOT, 'public', 'fonts', 'DejaVuSans-Bold.ttf');

const COLORS = {
  graphite: '#17191D',
  graphiteSoft: '#252930',
  orange: '#F06A24',
  paper: '#F7F5F1',
  ink: '#202329',
  muted: '#656B73',
  line: '#D9D5CF',
  white: '#FFFFFF',
} as const;

const PAGE = {
  width: 595.28,
  height: 841.89,
  margin: 42,
  footerY: 810,
} as const;

function pdfText(value: string): string {
  return value.replace(/[‐‑‒–—−]/g, '-');
}

function outputPathFor(profile: OrionEquipmentProfile): string {
  const relativePdfPath = profile.pdfPath.replace(/^\//, '');
  const outputPath = path.resolve(ROOT, 'public', relativePdfPath);
  const outputRoot = path.resolve(ROOT, 'public', 'orion', 'specs');

  if (path.dirname(outputPath) !== outputRoot) {
    throw new Error(`Unsafe ORION PDF path: ${profile.pdfPath}`);
  }

  return outputPath;
}

function sectionTitle(doc: PDFKit.PDFDocument, title: string, y: number): number {
  doc
    .font('Bold')
    .fontSize(8.5)
    .fillColor(COLORS.orange)
    .text(pdfText(title.toUpperCase()), PAGE.margin, y, { characterSpacing: 1.25 });
  doc
    .strokeColor(COLORS.line)
    .lineWidth(0.7)
    .moveTo(PAGE.margin + 125, y + 5)
    .lineTo(PAGE.width - PAGE.margin, y + 5)
    .stroke();

  return y + 19;
}

function drawSpecifications(
  doc: PDFKit.PDFDocument,
  profile: OrionEquipmentProfile,
  startY: number,
): number {
  const tableX = PAGE.margin;
  const tableWidth = PAGE.width - PAGE.margin * 2;
  const labelWidth = 295;
  const valueX = tableX + labelWidth;
  let y = startY;

  profile.specifications.forEach((specification, index) => {
    const label = pdfText(specification.label);
    const value = pdfText(specification.value);
    const labelHeight = doc.font('Regular').fontSize(9.2).heightOfString(label, {
      width: labelWidth - 24,
    });
    const valueHeight = doc.font('Bold').fontSize(9.2).heightOfString(value, {
      width: tableWidth - labelWidth - 24,
    });
    const rowHeight = Math.max(27, Math.max(labelHeight, valueHeight) + 12);

    if (index % 2 === 0) {
      doc.rect(tableX, y, tableWidth, rowHeight).fill('#F0EDE8');
    }

    doc
      .strokeColor(COLORS.line)
      .lineWidth(0.5)
      .moveTo(tableX, y + rowHeight)
      .lineTo(tableX + tableWidth, y + rowHeight)
      .stroke();

    doc
      .font('Regular')
      .fontSize(9.2)
      .fillColor(COLORS.ink)
      .text(label, tableX + 10, y + 7, { width: labelWidth - 20 });

    doc
      .font('Bold')
      .fontSize(9.2)
      .fillColor(COLORS.graphite)
      .text(value, valueX + 10, y + 7, {
        width: tableWidth - labelWidth - 20,
        align: 'right',
        lineBreak: false,
      });

    y += rowHeight;
  });

  doc
    .strokeColor(COLORS.line)
    .lineWidth(0.7)
    .rect(tableX, startY, tableWidth, y - startY)
    .stroke();

  return y;
}

function drawFeatures(
  doc: PDFKit.PDFDocument,
  profile: OrionEquipmentProfile,
  startY: number,
): number {
  let y = startY;

  profile.features.forEach((feature, index) => {
    doc.circle(PAGE.margin + 9, y + 7, 8).fill(COLORS.orange);
    doc
      .font('Bold')
      .fontSize(8.5)
      .fillColor(COLORS.white)
      .text(String(index + 1), PAGE.margin + 5, y + 2.5, {
        width: 8,
        align: 'center',
      });

    const featureText = pdfText(feature);
    const featureHeight = doc.font('Regular').fontSize(9.2).heightOfString(featureText, {
      width: PAGE.width - PAGE.margin * 2 - 35,
    });
    doc
      .fillColor(COLORS.ink)
      .text(featureText, PAGE.margin + 28, y + 1, {
        width: PAGE.width - PAGE.margin * 2 - 35,
      });
    y += Math.max(21, featureHeight + 6);
  });

  return y;
}

function createEquipmentPdf(profile: OrionEquipmentProfile): Promise<{ file: string; size: number }> {
  const outputPath = outputPathFor(profile);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: {
        top: PAGE.margin,
        right: PAGE.margin,
        bottom: 18,
        left: PAGE.margin,
      },
      autoFirstPage: true,
      bufferPages: true,
      info: {
        Title: `ОРИОН - ${profile.model}: справочная карточка`,
        Author: 'ОРИОН',
        Subject: 'Справочные характеристики модели',
        Keywords: 'ОРИОН, свайные работы, оборудование',
        CreationDate: new Date('2026-07-15T00:00:00.000Z'),
        ModDate: new Date('2026-07-15T00:00:00.000Z'),
      },
    });
    const stream = fs.createWriteStream(outputPath);

    stream.on('error', reject);
    stream.on('finish', () => {
      resolve({ file: outputPath, size: fs.statSync(outputPath).size });
    });
    doc.on('error', reject);
    doc.pipe(stream);

    doc.registerFont('Regular', REGULAR_FONT);
    doc.registerFont('Bold', BOLD_FONT);

    doc.rect(0, 0, PAGE.width, 112).fill(COLORS.graphite);
    doc.rect(PAGE.margin, 103, 74, 4).fill(COLORS.orange);

    doc
      .font('Bold')
      .fontSize(11)
      .fillColor(COLORS.orange)
      .text('ОРИОН', PAGE.margin, 28, { characterSpacing: 2.2 });

    doc
      .font('Regular')
      .fontSize(8)
      .fillColor('#BFC3C9')
      .text('СПРАВОЧНАЯ КАРТОЧКА ОБОРУДОВАНИЯ', PAGE.margin + 88, 31, {
        characterSpacing: 0.75,
      });

    doc
      .font('Bold')
      .fontSize(24)
      .fillColor(COLORS.white)
      .text(pdfText(profile.model), PAGE.margin, 54, {
        width: PAGE.width - PAGE.margin * 2,
      });

    let y = 132;
    y = sectionTitle(doc, 'О модели', y);

    const description = pdfText(profile.description);
    const descriptionHeight = doc.font('Regular').fontSize(9.4).heightOfString(description, {
      width: PAGE.width - PAGE.margin * 2,
      lineGap: 2,
    });
    doc
      .fillColor(COLORS.ink)
      .text(description, PAGE.margin, y, {
        width: PAGE.width - PAGE.margin * 2,
        lineGap: 2,
      });
    y += descriptionHeight + 16;

    y = sectionTitle(doc, 'Технические характеристики', y);
    y = drawSpecifications(doc, profile, y);
    y += 16;

    y = sectionTitle(doc, 'Основные особенности', y);
    y = drawFeatures(doc, profile, y);
    y += 9;

    const noticeText = pdfText(profile.disclaimer);
    const noticeTextHeight = doc.font('Regular').fontSize(8.6).heightOfString(noticeText, {
      width: PAGE.width - PAGE.margin * 2 - 26,
      lineGap: 1.5,
    });
    const noticeHeight = noticeTextHeight + 20;

    doc
      .roundedRect(PAGE.margin, y, PAGE.width - PAGE.margin * 2, noticeHeight, 4)
      .fill('#FFF1E7');
    doc.rect(PAGE.margin, y, 4, noticeHeight).fill(COLORS.orange);
    doc
      .font('Regular')
      .fontSize(8.6)
      .fillColor(COLORS.ink)
      .text(noticeText, PAGE.margin + 14, y + 9, {
        width: PAGE.width - PAGE.margin * 2 - 26,
        lineGap: 1.5,
      });
    y += noticeHeight + 12;

    doc
      .font('Bold')
      .fontSize(7.8)
      .fillColor(COLORS.muted)
      .text('ИСТОЧНИК', PAGE.margin, y, { characterSpacing: 0.8 });
    y += 13;

    const sourceUrl = pdfText(profile.source.url);
    doc
      .font('Regular')
      .fontSize(7.4)
      .fillColor(COLORS.graphiteSoft)
      .text(sourceUrl, PAGE.margin, y, {
        width: PAGE.width - PAGE.margin * 2,
        link: profile.source.url,
        underline: true,
        lineGap: 1,
      });

    const contentEndY = doc.y;

    doc
      .strokeColor(COLORS.line)
      .lineWidth(0.7)
      .moveTo(PAGE.margin, 797)
      .lineTo(PAGE.width - PAGE.margin, 797)
      .stroke();

    doc
      .font('Bold')
      .fontSize(7.7)
      .fillColor(COLORS.graphite)
      .text(`ОРИОН · ${profile.preparedAt}`, PAGE.margin, PAGE.footerY, {
        width: 180,
        lineBreak: false,
      });

    doc
      .font('Regular')
      .fontSize(7.5)
      .fillColor(COLORS.muted)
      .text('Справочная карточка ОРИОН · не официальный перевод производителя', 240, PAGE.footerY, {
        width: PAGE.width - PAGE.margin - 240,
        align: 'right',
        lineBreak: false,
      });

    if (contentEndY > 785) {
      reject(new Error(`${profile.model}: content reaches footer at y=${contentEndY.toFixed(1)}`));
      doc.end();
      return;
    }

    doc.end();
  });
}

async function main(): Promise<void> {
  const profiles = Object.values(orionEquipmentProfiles);
  if (profiles.length !== 6) {
    throw new Error(`Expected 6 ORION equipment profiles, received ${profiles.length}`);
  }

  for (const profile of profiles) {
    const result = await createEquipmentPdf(profile);
    console.log(`${path.relative(ROOT, result.file)} - ${result.size} bytes`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});