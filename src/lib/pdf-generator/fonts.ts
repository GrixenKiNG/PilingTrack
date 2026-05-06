import { existsSync } from 'fs';
import { join } from 'path';
import type { FontPaths, PdfDoc } from './types';

function firstExisting(candidates: string[]): string | null {
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

export function resolvePdfFonts(): FontPaths {
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

export function registerFonts(doc: PdfDoc) {
  const fonts = resolvePdfFonts();
  for (const [name, path] of Object.entries(fonts)) {
    doc.registerFont(name, path);
  }
  doc.font('Regular');
}
