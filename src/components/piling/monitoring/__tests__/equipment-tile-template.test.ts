import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EQUIPMENT_TILE_TEMPLATE,
  validateEquipmentTileTemplate,
} from '../equipment-tile-template';
import {
  EQUIPMENT_TILE_TEMPLATE_STORAGE_KEY,
  loadEquipmentTileTemplate,
  resetEquipmentTileTemplate,
  saveEquipmentTileTemplate,
  type StorageLike,
} from '../equipment-tile-storage';
import { migrateLegacyCardDesign } from '../design-tuning-panel';

function createStorage(initial?: Record<string, string>): StorageLike {
  const values = new Map(Object.entries(initial ?? {}));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  };
}

describe('equipment tile template', () => {
  it('accepts and clones the default template', () => {
    const result = validateEquipmentTileTemplate(DEFAULT_EQUIPMENT_TILE_TEMPLATE);

    expect(result).toEqual(DEFAULT_EQUIPMENT_TILE_TEMPLATE);
    expect(result).not.toBe(DEFAULT_EQUIPMENT_TILE_TEMPLATE);
    expect(result?.blocks).not.toBe(DEFAULT_EQUIPMENT_TILE_TEMPLATE.blocks);
  });

  it('rejects blocks outside the 12-column grid', () => {
    const invalid = structuredClone(DEFAULT_EQUIPMENT_TILE_TEMPLATE);
    invalid.blocks[0].x = 12;

    expect(validateEquipmentTileTemplate(invalid)).toBeNull();
  });

  it('rejects unknown block data keys', () => {
    const invalid = structuredClone(DEFAULT_EQUIPMENT_TILE_TEMPLATE) as unknown as {
      blocks: Array<{ dataKey?: string }>;
    };
    invalid.blocks[0].dataKey = 'inventedTelemetry';

    expect(validateEquipmentTileTemplate(invalid)).toBeNull();
  });

  it('falls back to the default when local JSON is corrupt', () => {
    const storage = createStorage({
      [EQUIPMENT_TILE_TEMPLATE_STORAGE_KEY]: '{broken',
    });

    expect(loadEquipmentTileTemplate(storage)).toEqual(DEFAULT_EQUIPMENT_TILE_TEMPLATE);
  });

  it('round-trips a valid template', () => {
    const storage = createStorage();
    const template = structuredClone(DEFAULT_EQUIPMENT_TILE_TEMPLATE);
    template.card.width = 360;

    saveEquipmentTileTemplate(storage, template);

    expect(loadEquipmentTileTemplate(storage).card.width).toBe(360);
  });

  it('refuses to persist an invalid template', () => {
    const storage = createStorage();
    const invalid = structuredClone(DEFAULT_EQUIPMENT_TILE_TEMPLATE);
    invalid.card.width = -1;

    expect(() => saveEquipmentTileTemplate(storage, invalid)).toThrow(
      'Invalid equipment tile template',
    );
  });

  it('removes the saved template on reset', () => {
    const storage = createStorage();
    saveEquipmentTileTemplate(storage, DEFAULT_EQUIPMENT_TILE_TEMPLATE);

    resetEquipmentTileTemplate(storage);

    expect(storage.getItem(EQUIPMENT_TILE_TEMPLATE_STORAGE_KEY)).toBeNull();
  });

  it('migrates legacy local card dimensions once', () => {
    const storage = createStorage({
      'monitoring-card-design-v1': JSON.stringify({
        fontScale: 1.25,
        photoHeight: 288,
        density: 1.2,
        cardWidth: 340,
        cardHeight: 760,
      }),
    });

    migrateLegacyCardDesign(storage);

    const migrated = loadEquipmentTileTemplate(storage);
    expect(migrated.card.width).toBe(340);
    expect(migrated.card.minHeight).toBe(760);
    expect(migrated.blocks.find((block) => block.dataKey === 'photo')?.height).toBe(12);
    expect(migrated.blocks.find((block) => block.dataKey === 'site')?.style.fontSize).toBe(15);
  });
});
