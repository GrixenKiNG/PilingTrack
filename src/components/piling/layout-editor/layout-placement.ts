/**
 * Grid placement/collision helpers for layout templates (shared editor
 * engine). Extracted 1:1 from the monitoring equipment-tile layout module.
 */

import { LAYOUT_COLUMNS, type LayoutBlock } from './layout-template';

export function clampBlockToGrid<T extends LayoutBlock>(block: T): T {
  const x = Math.min(LAYOUT_COLUMNS - 1, Math.max(0, Math.round(block.x)));
  const y = Math.max(0, Math.round(block.y));
  const width = Math.min(
    LAYOUT_COLUMNS - x,
    Math.max(1, Math.round(block.width)),
  );
  const height = Math.max(1, Math.round(block.height));
  return { ...block, x, y, width, height };
}

export function blocksOverlap(a: LayoutBlock, b: LayoutBlock): boolean {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

function isFree(candidate: LayoutBlock, blocks: readonly LayoutBlock[]): boolean {
  return blocks.every((block) => block.id === candidate.id || !blocksOverlap(candidate, block));
}

export function placeBlock<T extends LayoutBlock>(block: T, blocks: readonly LayoutBlock[]): T {
  const requested = clampBlockToGrid(block);
  if (isFree(requested, blocks)) return requested;

  const maxStartX = LAYOUT_COLUMNS - requested.width;
  for (let y = requested.y; y <= requested.y + 1000; y += 1) {
    const firstX = y === requested.y ? requested.x : 0;
    for (let x = firstX; x <= maxStartX; x += 1) {
      const candidate = { ...requested, x, y };
      if (isFree(candidate, blocks)) return candidate;
    }
  }

  return requested;
}

export function resizeBlock<T extends LayoutBlock>(
  block: T,
  nextSize: Pick<LayoutBlock, 'width' | 'height'>,
  blocks: readonly LayoutBlock[],
): T {
  const candidate = clampBlockToGrid({ ...block, ...nextSize });
  return isFree(candidate, blocks) ? candidate : block;
}
