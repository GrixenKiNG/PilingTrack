export const EQUIPMENT_TILE_COLUMNS = 12;

export type EquipmentTileBlockKind = 'data' | 'text' | 'divider' | 'image';

export type EquipmentTileDataKey =
  | 'photo'
  | 'identity'
  | 'status'
  | 'inventoryNumber'
  | 'site'
  | 'operator'
  | 'engineHours'
  | 'maintenance'
  | 'todayPiles'
  | 'todayDrilling'
  | 'todayDowntime'
  | 'maintenanceAlert';

export interface EquipmentTileBlockStyle {
  background: string;
  color: string;
  borderColor: string;
  borderWidth: number;
  borderRadius: number;
  padding: number;
  fontSize: number;
  fontWeight: 400 | 500 | 600 | 700;
  textAlign: 'left' | 'center' | 'right';
  alignItems: 'start' | 'center' | 'end';
}

export interface EquipmentTileBlock {
  id: string;
  kind: EquipmentTileBlockKind;
  dataKey?: EquipmentTileDataKey;
  text?: string;
  assetId?: string;
  assetRevision?: number;
  imageFit?: 'contain' | 'cover';
  alt?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
  style: EquipmentTileBlockStyle;
}

export interface EquipmentTileTemplate {
  version: 1;
  card: {
    width: number;
    minHeight: number;
    rowHeight: number;
    gap: number;
    background: string;
    borderColor: string;
    borderWidth: number;
    borderRadius: number;
    padding: number;
  };
  blocks: EquipmentTileBlock[];
}

const DATA_KEYS = new Set<EquipmentTileDataKey>([
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
]);

const BLOCK_KINDS = new Set<EquipmentTileBlockKind>(['data', 'text', 'divider', 'image']);
const FONT_WEIGHTS = new Set([400, 500, 600, 700]);
const TEXT_ALIGNS = new Set(['left', 'center', 'right']);
const ITEM_ALIGNS = new Set(['start', 'center', 'end']);
const IMAGE_FITS = new Set(['contain', 'cover']);

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return Number.isInteger(value) && isFiniteInRange(value, min, max);
}

function isValidStyle(value: unknown): value is EquipmentTileBlockStyle {
  if (!isRecord(value)) return false;
  return (
    typeof value.background === 'string' &&
    typeof value.color === 'string' &&
    typeof value.borderColor === 'string' &&
    isFiniteInRange(value.borderWidth, 0, 12) &&
    isFiniteInRange(value.borderRadius, 0, 64) &&
    isFiniteInRange(value.padding, 0, 64) &&
    isFiniteInRange(value.fontSize, 8, 96) &&
    FONT_WEIGHTS.has(value.fontWeight as number) &&
    TEXT_ALIGNS.has(value.textAlign as string) &&
    ITEM_ALIGNS.has(value.alignItems as string)
  );
}

function isValidBlock(value: unknown): value is EquipmentTileBlock {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || value.id.trim().length === 0) return false;
  if (!BLOCK_KINDS.has(value.kind as EquipmentTileBlockKind)) return false;
  if (value.kind === 'data' && !DATA_KEYS.has(value.dataKey as EquipmentTileDataKey)) return false;
  if (value.kind === 'text' && typeof value.text !== 'string') return false;
  if (value.kind === 'image') {
    if (!IMAGE_FITS.has(value.imageFit as string) || typeof value.alt !== 'string') return false;
    if (value.assetRevision != null && !isFiniteInRange(value.assetRevision, 0, Number.MAX_SAFE_INTEGER)) return false;
  }
  if (!isIntegerInRange(value.x, 0, EQUIPMENT_TILE_COLUMNS - 1)) return false;
  if (!isIntegerInRange(value.y, 0, 999)) return false;
  if (!isIntegerInRange(value.width, 1, EQUIPMENT_TILE_COLUMNS)) return false;
  if (!isIntegerInRange(value.height, 1, 100)) return false;
  if ((value.x as number) + (value.width as number) > EQUIPMENT_TILE_COLUMNS) return false;
  return typeof value.visible === 'boolean' && isValidStyle(value.style);
}

function isValidCard(value: unknown): value is EquipmentTileTemplate['card'] {
  if (!isRecord(value)) return false;
  return (
    isFiniteInRange(value.width, 200, 1200) &&
    isFiniteInRange(value.minHeight, 240, 2400) &&
    isFiniteInRange(value.rowHeight, 12, 96) &&
    isFiniteInRange(value.gap, 0, 32) &&
    typeof value.background === 'string' &&
    typeof value.borderColor === 'string' &&
    isFiniteInRange(value.borderWidth, 0, 12) &&
    isFiniteInRange(value.borderRadius, 0, 64) &&
    isFiniteInRange(value.padding, 0, 64)
  );
}

export function cloneEquipmentTileTemplate(template: EquipmentTileTemplate): EquipmentTileTemplate {
  return JSON.parse(JSON.stringify(template)) as EquipmentTileTemplate;
}

export function validateEquipmentTileTemplate(value: unknown): EquipmentTileTemplate | null {
  if (!isRecord(value) || value.version !== 1 || !isValidCard(value.card) || !Array.isArray(value.blocks)) {
    return null;
  }
  if (!value.blocks.every(isValidBlock)) return null;
  const ids = value.blocks.map((block) => block.id);
  if (new Set(ids).size !== ids.length) return null;
  return cloneEquipmentTileTemplate(value as unknown as EquipmentTileTemplate);
}
