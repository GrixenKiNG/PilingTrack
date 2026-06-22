import PDFDocument from 'pdfkit';
import { addFooterAndPageNumbers } from './components';
import { registerFonts } from './fonts';
import type { PdfDoc } from './types';

export function renderPdf(draw: (doc: PdfDoc) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // font: false — skip loading the built-in Helvetica.afm at construction time.
    // Bundlers (Turbopack/webpack) do not reliably include pdfkit's internal .afm
    // assets, so we register our own TTF fonts in registerFonts() right after.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped external/library boundary
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
