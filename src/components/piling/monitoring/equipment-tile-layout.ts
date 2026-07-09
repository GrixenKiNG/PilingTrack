import { EQUIPMENT_TILE_COLUMNS, type EquipmentTileBlock } from './equipment-tile-template';

export function clampBlockToGrid(block: EquipmentTileBlock): EquipmentTileBlock {
  const x = Math.min(EQUIPMENT_TILE_COLUMNS - 1, Math.max(0, Math.round(block.x)));
  const y = Math.max(0, Math.round(block.y));
  const width = Math.min(
    EQUIPMENT_TILE_COLUMNS - x,
    Math.max(1, Math.round(block.width)),
  );
  const height = Math.max(1, Math.round(block.height));
  return { ...block, x, y, width, height };
}

export function blocksOverlap(a: EquipmentTileBlock, b: EquipmentTileBlock): boolean {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

function isFree(candidate: EquipmentTileBlock, blocks: EquipmentTileBlock[]): boolean {
  return blocks.every((block) => block.id === candidate.id || !blocksOverlap(candidate, block));
}

export function placeBlock(block: EquipmentTileBlock, blocks: EquipmentTileBlock[]): EquipmentTileBlock {
  const requested = clampBlockToGrid(block);
  if (isFree(requested, blocks)) return requested;

  const maxStartX = EQUIPMENT_TILE_COLUMNS - requested.width;
  for (let y = requested.y; y <= requested.y + 1000; y += 1) {
    const firstX = y === requested.y ? requested.x : 0;
    for (let x = firstX; x <= maxStartX; x += 1) {
      const candidate = { ...requested, x, y };
      if (isFree(candidate, blocks)) return candidate;
    }
  }

  return requested;
}

export function resizeBlock(
  block: EquipmentTileBlock,
  nextSize: Pick<EquipmentTileBlock, 'width' | 'height'>,
  blocks: EquipmentTileBlock[],
): EquipmentTileBlock {
  const candidate = clampBlockToGrid({ ...block, ...nextSize });
  return isFree(candidate, blocks) ? candidate : block;
}

