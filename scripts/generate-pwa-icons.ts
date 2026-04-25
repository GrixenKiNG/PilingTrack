/**
 * Generate PNG icons for PWA install on Android, iOS, and desktop.
 *
 * iOS does not reliably render SVG apple-touch-icons; Android Chrome and
 * the Play Store install prompt prefer PNG too. The source is the
 * existing public/icon-512.svg — sharp rasterises it at the sizes below.
 *
 * Usage:
 *   npx tsx scripts/generate-pwa-icons.ts
 */

import sharp from 'sharp';
import { mkdirSync, readFileSync } from 'fs';
import { join } from 'path';

const PUBLIC = join(process.cwd(), 'public');
const ICONS_DIR = join(PUBLIC, 'icons');
mkdirSync(ICONS_DIR, { recursive: true });

const SOURCE = readFileSync(join(PUBLIC, 'icon-512.svg'));

// Standard set:
//   180 — iOS apple-touch-icon (covers iPhone + iPad retina)
//   192 — Android Chrome / web manifest baseline
//   512 — splash screens, store listings, install prompt
//   144 — older Android (pre-Chrome)
//   167 — iPad Pro
//   152 — iPad
const REGULAR_SIZES = [144, 152, 167, 180, 192, 384, 512];

// Maskable icons need extra padding (Android adaptive icon safe zone is ~80%
// of the canvas). Scale the rasterised image down to ~80% and centre on a
// solid background matching the brand colour.
const MASKABLE_SIZES = [192, 512];
const BRAND_COLOR = '#3B82F6';

async function main() {
  console.log('Generating regular PNG icons...');
  for (const size of REGULAR_SIZES) {
    await sharp(SOURCE)
      .resize(size, size)
      .png({ compressionLevel: 9 })
      .toFile(join(ICONS_DIR, `icon-${size}.png`));
    console.log(`  ✓ icon-${size}.png`);
  }

  console.log('Generating maskable icons (with safe-zone padding)...');
  for (const size of MASKABLE_SIZES) {
    const inner = Math.round(size * 0.78); // 80% safe zone
    const padding = Math.round((size - inner) / 2);
    const innerBuffer = await sharp(SOURCE).resize(inner, inner).png().toBuffer();
    await sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: BRAND_COLOR,
      },
    })
      .composite([{ input: innerBuffer, top: padding, left: padding }])
      .png({ compressionLevel: 9 })
      .toFile(join(ICONS_DIR, `icon-${size}-maskable.png`));
    console.log(`  ✓ icon-${size}-maskable.png`);
  }

  // Apple touch icon — 180x180 is the canonical name iOS looks for.
  await sharp(SOURCE)
    .resize(180, 180)
    .png({ compressionLevel: 9 })
    .toFile(join(PUBLIC, 'apple-touch-icon.png'));
  console.log('  ✓ apple-touch-icon.png (root)');

  // Favicon — 32x32 PNG fallback
  await sharp(SOURCE)
    .resize(32, 32)
    .png({ compressionLevel: 9 })
    .toFile(join(PUBLIC, 'favicon-32.png'));
  console.log('  ✓ favicon-32.png (root)');

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
