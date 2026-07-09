import {
  cloneEquipmentTileTemplate,
  DEFAULT_EQUIPMENT_TILE_TEMPLATE,
  type EquipmentTileTemplate,
  validateEquipmentTileTemplate,
} from './equipment-tile-template';

export const EQUIPMENT_TILE_TEMPLATE_STORAGE_KEY = 'monitoring-equipment-tile-template-v1';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function loadEquipmentTileTemplate(storage: StorageLike): EquipmentTileTemplate {
  const saved = storage.getItem(EQUIPMENT_TILE_TEMPLATE_STORAGE_KEY);
  if (!saved) return cloneEquipmentTileTemplate(DEFAULT_EQUIPMENT_TILE_TEMPLATE);
  try {
    return (
      validateEquipmentTileTemplate(JSON.parse(saved)) ??
      cloneEquipmentTileTemplate(DEFAULT_EQUIPMENT_TILE_TEMPLATE)
    );
  } catch {
    return cloneEquipmentTileTemplate(DEFAULT_EQUIPMENT_TILE_TEMPLATE);
  }
}

export function saveEquipmentTileTemplate(
  storage: StorageLike,
  template: EquipmentTileTemplate,
): void {
  const validated = validateEquipmentTileTemplate(template);
  if (!validated) throw new TypeError('Invalid equipment tile template');
  storage.setItem(EQUIPMENT_TILE_TEMPLATE_STORAGE_KEY, JSON.stringify(validated));
}

export function resetEquipmentTileTemplate(storage: StorageLike): void {
  storage.removeItem(EQUIPMENT_TILE_TEMPLATE_STORAGE_KEY);
}
