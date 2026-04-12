const fs = require('fs');
const path = require('path');

function firstExisting(candidates) {
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

function resolvePdfFonts() {
  const windowsFontDir = process.env.WINDIR
    ? path.join(process.env.WINDIR, 'Fonts')
    : 'C:\\Windows\\Fonts';

  const shared = {
    regular: [
      path.join(process.cwd(), 'public', 'fonts', 'DejaVuSans.ttf'),
      path.join(windowsFontDir, 'arial.ttf'),
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      '/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf',
    ],
    bold: [
      path.join(process.cwd(), 'public', 'fonts', 'DejaVuSans-Bold.ttf'),
      path.join(windowsFontDir, 'arialbd.ttf'),
      '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
      '/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf',
    ],
    oblique: [
      path.join(process.cwd(), 'public', 'fonts', 'DejaVuSans-Oblique.ttf'),
      path.join(windowsFontDir, 'ariali.ttf'),
      '/usr/share/fonts/truetype/dejavu/DejaVuSans-Oblique.ttf',
      '/usr/share/fonts/truetype/liberation2/LiberationSans-Italic.ttf',
    ],
    boldOblique: [
      path.join(process.cwd(), 'public', 'fonts', 'DejaVuSans-BoldOblique.ttf'),
      path.join(windowsFontDir, 'arialbi.ttf'),
      '/usr/share/fonts/truetype/dejavu/DejaVuSans-BoldOblique.ttf',
      '/usr/share/fonts/truetype/liberation2/LiberationSans-BoldItalic.ttf',
    ],
    serif: [
      path.join(process.cwd(), 'public', 'fonts', 'DejaVuSerif.ttf'),
      path.join(windowsFontDir, 'times.ttf'),
      '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf',
      '/usr/share/fonts/truetype/liberation2/LiberationSerif-Regular.ttf',
    ],
    serifBold: [
      path.join(process.cwd(), 'public', 'fonts', 'DejaVuSerif-Bold.ttf'),
      path.join(windowsFontDir, 'timesbd.ttf'),
      '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf',
      '/usr/share/fonts/truetype/liberation2/LiberationSerif-Bold.ttf',
    ],
  };

  const regular = firstExisting(shared.regular);
  const bold = firstExisting(shared.bold);

  if (!regular || !bold) {
    throw new Error(
      'No compatible PDF fonts found. Add DejaVu fonts to public/fonts or install system fonts.'
    );
  }

  return {
    Regular: regular,
    Bold: bold,
    Oblique: firstExisting(shared.oblique) || regular,
    BoldOblique: firstExisting(shared.boldOblique) || bold,
    Serif: firstExisting(shared.serif) || regular,
    SerifBold: firstExisting(shared.serifBold) || bold,
  };
}

module.exports = {
  resolvePdfFonts,
};
