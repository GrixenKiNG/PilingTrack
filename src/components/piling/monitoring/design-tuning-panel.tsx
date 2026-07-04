import {
  EQUIPMENT_TILE_TEMPLATE_STORAGE_KEY,
  saveEquipmentTileTemplate,
  type StorageLike,
} from './equipment-tile-storage';
import {
  cloneEquipmentTileTemplate,
  DEFAULT_EQUIPMENT_TILE_TEMPLATE,
} from './equipment-tile-template';

const LEGACY_STORAGE_KEY = 'monitoring-card-design-v1';
const MIGRATION_KEY = 'monitoring-equipment-tile-template-v1-migrated';

interface LegacyCardDesign {
  fontScale?: number;
  photoHeight?: number;
  density?: number;
  cardWidth?: number;
  cardHeight?: number | null;
}

function finite(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

/**
 * One-time compatibility bridge from the original slider-only tuning panel.
 * It never overwrites a template created by the visual editor.
 */
export function migrateLegacyCardDesign(storage: StorageLike): void {
  if (storage.getItem(MIGRATION_KEY) === '1') return;
  if (storage.getItem(EQUIPMENT_TILE_TEMPLATE_STORAGE_KEY)) {
    storage.setItem(MIGRATION_KEY, '1');
    return;
  }

  const raw = storage.getItem(LEGACY_STORAGE_KEY);
  if (!raw) {
    storage.setItem(MIGRATION_KEY, '1');
    return;
  }

  try {
    const legacy = JSON.parse(raw) as LegacyCardDesign;
    const next = cloneEquipmentTileTemplate(DEFAULT_EQUIPMENT_TILE_TEMPLATE);
    const fontScale = finite(legacy.fontScale, 1, 0.75, 1.4);
    const density = finite(legacy.density, 1, 0.5, 1.75);
    const photoHeight = finite(legacy.photoHeight, 220, 140, 480);
    next.card.width = finite(legacy.cardWidth, next.card.width, 200, 1200);
    next.card.minHeight = finite(legacy.cardHeight, next.card.minHeight, 240, 2400);
    next.card.gap = Math.round(next.card.gap * density);
    next.card.padding = Math.round(next.card.padding * density);
    next.blocks = next.blocks.map((block) => ({
      ...block,
      height: block.dataKey === 'photo' ? Math.max(1, Math.round(photoHeight / next.card.rowHeight)) : block.height,
      style: {
        ...block.style,
        padding: Math.round(block.style.padding * density),
        fontSize: Math.round(block.style.fontSize * fontScale),
      },
    }));
    saveEquipmentTileTemplate(storage, next);
  } catch {
    // A malformed legacy value is deliberately ignored; the new safe default wins.
  } finally {
    storage.setItem(MIGRATION_KEY, '1');
  }
}
