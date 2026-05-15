import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'public', 'icon-512.png');

const outputs = [
  { file: 'icons/icon-144.png', size: 144 },
  { file: 'icons/icon-152.png', size: 152 },
  { file: 'icons/icon-167.png', size: 167 },
  { file: 'icons/icon-180.png', size: 180 },
  { file: 'icons/icon-192.png', size: 192 },
  { file: 'icons/icon-384.png', size: 384 },
  { file: 'icons/icon-512.png', size: 512 },
  { file: 'apple-touch-icon.png', size: 180 },
  { file: 'favicon-32.png', size: 32 },
  { file: 'favicon-48.png', size: 48 },
  { file: 'favicon-96.png', size: 96 },
];

const maskableOutputs = [
  { file: 'icons/icon-192-maskable.png', size: 192 },
  { file: 'icons/icon-512-maskable.png', size: 512 },
];

for (const { file, size } of outputs) {
  const out = path.join(root, 'public', file);
  await sharp(src).resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(out);
  console.log(`✓ ${file} (${size}×${size})`);
}

for (const { file, size } of maskableOutputs) {
  const out = path.join(root, 'public', file);
  const inner = Math.round(size * 0.8);
  const padding = Math.round((size - inner) / 2);
  await sharp(src)
    .resize(inner, inner)
    .extend({ top: padding, bottom: padding, left: padding, right: padding, background: { r: 26, g: 60, b: 110, alpha: 1 } })
    .png()
    .toFile(out);
  console.log(`✓ ${file} (${size}×${size}, maskable, 80% safe area)`);
}

console.log('\nDone. Source: public/icon-512.png');
