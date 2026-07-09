import { describe, expect, it } from 'vitest';
import { DEFAULT_EQUIPMENT_TILE_TEMPLATE, type EquipmentTileBlock } from '../equipment-tile-template';
import { blocksOverlap, clampBlockToGrid, placeBlock, resizeBlock } from '../equipment-tile-layout';

const block: EquipmentTileBlock = structuredClone(DEFAULT_EQUIPMENT_TILE_TEMPLATE.blocks[1]);

describe('equipment tile grid layout', () => {
  it('clamps a resized block to 12 columns', () => {
    expect(clampBlockToGrid({ ...block, x: 10, width: 5 })).toMatchObject({ x: 10, width: 2 });
  });

  it('normalizes fractional and negative positions', () => {
    expect(clampBlockToGrid({ ...block, x: -2.4, y: -3.8, width: 2.6, height: 0 })).toMatchObject({
      x: 0,
      y: 0,
      width: 3,
      height: 1,
    });
  });

  it('detects rectangle overlap but permits touching edges', () => {
    expect(blocksOverlap({ ...block, x: 0, y: 0, width: 4, height: 2 }, { ...block, x: 3, y: 1, width: 4, height: 2 })).toBe(true);
    expect(blocksOverlap({ ...block, x: 0, y: 0, width: 4, height: 2 }, { ...block, x: 4, y: 0, width: 4, height: 2 })).toBe(false);
  });

  it('moves a colliding block to the first free row', () => {
    const occupied = { ...block, id: 'occupied', x: 0, y: 0, width: 6, height: 3 };
    const placed = placeBlock({ ...block, id: 'moving', x: 0, y: 0, width: 6, height: 3 }, [occupied]);

    expect(placed).toMatchObject({ x: 6, y: 0 });
  });

  it('ignores the block being moved when resolving collision', () => {
    const placed = placeBlock({ ...block, x: 2, y: 2 }, [{ ...block, x: 0, y: 0 }]);
    expect(placed).toMatchObject({ x: 2, y: 2 });
  });

  it('keeps the previous size when no resized rectangle is free', () => {
    const target = { ...block, id: 'target', x: 0, y: 0, width: 6, height: 2 };
    const obstacle = { ...block, id: 'obstacle', x: 6, y: 0, width: 6, height: 10 };

    expect(resizeBlock(target, { width: 12, height: 4 }, [target, obstacle])).toEqual(target);
  });
});

