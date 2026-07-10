/**
 * Monitoring surface template: types, block catalog keys, default template
 * and validator for the /monitoring equipment tile. The grid model and
 * validation engine live in the shared layout-editor module; this file only
 * narrows them to the monitoring block catalog.
 */

import {
  cloneLayoutTemplate,
  createTemplateValidator,
  LAYOUT_COLUMNS,
  type LayoutBlock,
  type LayoutBlockKind,
  type LayoutBlockStyle,
  type LayoutTemplate,
} from '@/components/piling/layout-editor/layout-template';

export const EQUIPMENT_TILE_COLUMNS = LAYOUT_COLUMNS;

export type EquipmentTileBlockKind = LayoutBlockKind;
export type EquipmentTileBlockStyle = LayoutBlockStyle;

export const EQUIPMENT_TILE_DATA_KEYS = [
  'photo',
  'identity',
  'status',
  'inventoryNumber',
  'site',
  'operator',
  'engineHours',
  'maintenance',
  'todayPiles',
  'todayDrilling',
  'todayDowntime',
  'maintenanceAlert',
] as const;

export type EquipmentTileDataKey = (typeof EQUIPMENT_TILE_DATA_KEYS)[number];

export interface EquipmentTileBlock extends LayoutBlock {
  dataKey?: EquipmentTileDataKey;
}

export interface EquipmentTileTemplate extends LayoutTemplate {
  blocks: EquipmentTileBlock[];
}

const BASE_STYLE: EquipmentTileBlockStyle = {
  background: '#ffffff',
  color: '#0f172a',
  borderColor: '#e2e8f0',
  borderWidth: 1,
  borderRadius: 12,
  padding: 8,
  fontSize: 12,
  fontWeight: 600,
  textAlign: 'left',
  alignItems: 'center',
};

function dataBlock(
  id: string,
  dataKey: EquipmentTileDataKey,
  x: number,
  y: number,
  width: number,
  height: number,
  style: Partial<EquipmentTileBlockStyle> = {},
): EquipmentTileBlock {
  return {
    id,
    kind: 'data',
    dataKey,
    x,
    y,
    width,
    height,
    visible: true,
    style: { ...BASE_STYLE, ...style },
  };
}

export const DEFAULT_EQUIPMENT_TILE_TEMPLATE: EquipmentTileTemplate = {
  version: 1,
  card: {
    width: 272,
    minHeight: 620,
    rowHeight: 24,
    gap: 8,
    background: '#ffffff',
    borderColor: '#e2e8f0',
    borderWidth: 1,
    borderRadius: 16,
    padding: 8,
  },
  blocks: [
    dataBlock('photo', 'photo', 0, 0, 12, 9, {
      padding: 0,
      borderWidth: 0,
      borderRadius: 12,
      background: '#cbd5e1',
      color: '#ffffff',
      fontSize: 16,
      fontWeight: 700,
    }),
    dataBlock('site', 'site', 0, 9, 6, 3),
    dataBlock('operator', 'operator', 6, 9, 6, 3),
    dataBlock('engine-hours', 'engineHours', 0, 12, 6, 3),
    dataBlock('maintenance', 'maintenance', 6, 12, 6, 3),
    dataBlock('today-piles', 'todayPiles', 0, 15, 4, 3),
    dataBlock('today-drilling', 'todayDrilling', 4, 15, 4, 3),
    dataBlock('today-downtime', 'todayDowntime', 8, 15, 4, 3),
    dataBlock('maintenance-alert', 'maintenanceAlert', 0, 18, 12, 2, {
      background: '#fffbeb',
      color: '#92400e',
      borderColor: '#fde68a',
    }),
  ],
};

export function cloneEquipmentTileTemplate(template: EquipmentTileTemplate): EquipmentTileTemplate {
  return cloneLayoutTemplate(template);
}

const validate = createTemplateValidator(EQUIPMENT_TILE_DATA_KEYS);

export function validateEquipmentTileTemplate(value: unknown): EquipmentTileTemplate | null {
  return validate(value) as EquipmentTileTemplate | null;
}
