const path = require('node:path');
const sharp = require('sharp');

/**
 * Crops the 6x6 approved icon sheet into individual, transparent-background
 * glyph PNGs. The sheet packs each glyph above a Russian caption inside a
 * nominal 209x209 cell; the captions drift upward row-by-row (bottom margin of
 * the generated art), so a naive fixed-height extract bled a strip of the
 * neighbouring row's caption into the crop. We instead:
 *   1. detect the glyph's top edge and the caption band per-cell,
 *   2. clamp the bottom to a per-row ceiling (just above the caption),
 *   3. flood-fill the near-white/near-grey sheet background to transparent,
 *   4. trim to the glyph and pad to a uniform square canvas.
 * Result: clean, caption-free, uniformly framed glyphs that sit on any tile
 * colour. Re-run with `node scripts/crop-approved-icons.cjs`.
 */

const source = path.join(process.cwd(), 'public', 'icons', 'pilingtrack', 'approved-icon-sheet.png');
const outputDir = path.dirname(source);
const CELL = 209;
const OUT = 200; // square output canvas
const ROW_CEIL = [184, 182, 174, 166, 153, 146]; // max glyph bottom per row (caption starts just below)

// [name, col, row] in sheet order.
const cells = [
  ['shift-start', 0, 0], ['inspection', 1, 0], ['engine-hours', 2, 0], ['defect', 3, 0], ['camera', 4, 0], ['send', 5, 0],
  ['pile-group', 0, 1], ['pile-driving', 1, 1], ['drilling-auger', 2, 1], ['linear-meters', 3, 1], ['downtime', 4, 1], ['downtime-reason', 5, 1],
  ['technical-readiness', 0, 2], ['maintenance-due', 1, 2], ['repair', 2, 2], ['work-order', 3, 2], ['spare-parts', 4, 2], ['accepted', 5, 2],
  ['site', 0, 3], ['equipment-rig', 1, 3], ['crew', 2, 3], ['operator', 3, 3], ['dispatcher', 4, 3], ['administrator', 5, 3],
  ['monitoring', 0, 4], ['reports', 1, 4], ['history', 2, 4], ['analytics', 3, 4], ['risk', 4, 4], ['notifications', 5, 4],
  ['documents', 0, 5], ['users', 1, 5], ['settings', 2, 5], ['folder', 3, 5], ['telegram', 4, 5], ['logout', 5, 5],
];

/** Sheet background: near-white / light grey (the cell's rounded plate). */
function isBackground(r, g, b) {
  return r > 222 && g > 222 && b > 222 && Math.max(r, g, b) - Math.min(r, g, b) < 16;
}

// Detect glyph top edge and caption band within a cell. Content is "not
// background" rather than "dark": the operator's orange helmet greys out to
// ~152, so a dark-pixel threshold skipped it and the crop sheared the helmet
// off at the head outline.
async function glyphBounds(col, row) {
  const { data, info } = await sharp(source)
    .extract({ left: col * CELL, top: row * CELL, width: CELL, height: CELL })
    .raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, ch = info.channels;
  const ink = new Array(H).fill(0);
  for (let y = 0; y < H; y++) {
    let n = 0;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * ch;
      if (!isBackground(data[i], data[i + 1], data[i + 2])) n++;
    }
    ink[y] = n;
  }
  let gTop = 6;
  while (gTop < H && ink[gTop] <= 4) gTop++;
  // caption = bottom-most contiguous ink run below y=120
  let captionTop = H;
  for (let y = H - 1; y > 120; y--) {
    if (ink[y] > 4) { while (y > 120 && ink[y] > 4) y--; captionTop = y + 1; break; }
  }
  return { top: Math.max(0, gTop - 9), bot: Math.min(captionTop - 4, ROW_CEIL[row]) };
}

// Flood-fill the sheet background (near-white / light grey) from the borders to alpha 0.
function floodTransparent(data, W, H) {
  const isBg = (i) => isBackground(data[i], data[i + 1], data[i + 2]);
  const seen = new Uint8Array(W * H);
  const st = [];
  for (let x = 0; x < W; x++) { st.push(x); st.push((H - 1) * W + x); }
  for (let y = 0; y < H; y++) { st.push(y * W); st.push(y * W + W - 1); }
  while (st.length) {
    const p = st.pop();
    if (seen[p]) continue;
    seen[p] = 1;
    const i = p * 4;
    if (!isBg(i)) continue;
    data[i + 3] = 0;
    const px = p % W, py = (p / W) | 0;
    if (px > 0) st.push(p - 1);
    if (px < W - 1) st.push(p + 1);
    if (py > 0) st.push(p - W);
    if (py < H - 1) st.push(p + W);
  }
}

async function cropOne(name, col, row) {
  const { top, bot } = await glyphBounds(col, row);
  const h = Math.max(20, bot - top);
  const { data, info } = await sharp(source)
    .extract({ left: col * CELL + 4, top: row * CELL + top, width: CELL - 8, height: h })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  floodTransparent(data, info.width, info.height);
  const glyph = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  const trimmed = await sharp(glyph).trim({ threshold: 8 }).toBuffer().catch(() => glyph);
  await sharp(trimmed)
    .resize(OUT - 24, OUT - 24, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({ top: 12, bottom: 12, left: 12, right: 12, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(outputDir, `${name}.png`));
}

async function main() {
  for (const [name, col, row] of cells) await cropOne(name, col, row);
  console.log(`Created ${cells.length} transparent approved icon assets (${OUT}x${OUT}).`);
}

void main();
