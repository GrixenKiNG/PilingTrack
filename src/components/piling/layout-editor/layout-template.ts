/**
 * Generic layout template model for the shared module layout editor.
 *
 * A template is a 12-column grid of blocks (data / text / divider / image).
 * The set of valid `dataKey`s is surface-specific, so validation is built via
 * `createTemplateValidator(dataKeys)` — each editable surface passes its own
 * block catalog. Pure module (no React): safe to import from API routes.
 *
 * Extracted 1:1 from the monitoring equipment-tile template (the original
 * surface); size caps keep an ADMIN-authored template from ballooning the
 * JSONB row that is served to every viewer on every load.
 */

export const LAYOUT_COLUMNS = 12;

export type LayoutBlockKind = 'data' | 'text' | 'divider' | 'image';

export interface LayoutBlockStyle {
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

export interface LayoutBlock {
  id: string;
  kind: LayoutBlockKind;
  dataKey?: string;
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
  style: LayoutBlockStyle;
}

export interface LayoutTemplate {
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
  blocks: LayoutBlock[];
}

const BLOCK_KINDS = new Set<LayoutBlockKind>(['data', 'text', 'divider', 'image']);
const FONT_WEIGHTS = new Set([400, 500, 600, 700]);
const TEXT_ALIGNS = new Set(['left', 'center', 'right']);
const ITEM_ALIGNS = new Set(['start', 'center', 'end']);
const IMAGE_FITS = new Set(['contain', 'cover']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return Number.isInteger(value) && isFiniteInRange(value, min, max);
}

function isShortString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max;
}

function isValidStyle(value: unknown): value is LayoutBlockStyle {
  if (!isRecord(value)) return false;
  return (
    isShortString(value.background, 200) &&
    isShortString(value.color, 200) &&
    isShortString(value.borderColor, 200) &&
    isFiniteInRange(value.borderWidth, 0, 12) &&
    isFiniteInRange(value.borderRadius, 0, 64) &&
    isFiniteInRange(value.padding, 0, 64) &&
    isFiniteInRange(value.fontSize, 8, 96) &&
    FONT_WEIGHTS.has(value.fontWeight as number) &&
    TEXT_ALIGNS.has(value.textAlign as string) &&
    ITEM_ALIGNS.has(value.alignItems as string)
  );
}

function isValidCard(value: unknown): value is LayoutTemplate['card'] {
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

export function cloneLayoutTemplate<T extends LayoutTemplate>(template: T): T {
  return JSON.parse(JSON.stringify(template)) as T;
}

export type LayoutTemplateValidator = (value: unknown) => LayoutTemplate | null;

export function createTemplateValidator(dataKeys: readonly string[]): LayoutTemplateValidator {
  const allowedDataKeys = new Set(dataKeys);

  function isValidBlock(value: unknown): value is LayoutBlock {
    if (!isRecord(value)) return false;
    if (!isShortString(value.id, 100) || value.id.trim().length === 0) return false;
    if (!BLOCK_KINDS.has(value.kind as LayoutBlockKind)) return false;
    if (value.kind === 'data' && !allowedDataKeys.has(value.dataKey as string)) return false;
    if (value.kind === 'text' && !isShortString(value.text, 2000)) return false;
    if (value.kind === 'image') {
      if (!IMAGE_FITS.has(value.imageFit as string) || !isShortString(value.alt, 300)) return false;
      if (value.assetRevision != null && !isFiniteInRange(value.assetRevision, 0, Number.MAX_SAFE_INTEGER)) return false;
    }
    if (!isIntegerInRange(value.x, 0, LAYOUT_COLUMNS - 1)) return false;
    if (!isIntegerInRange(value.y, 0, 999)) return false;
    if (!isIntegerInRange(value.width, 1, LAYOUT_COLUMNS)) return false;
    if (!isIntegerInRange(value.height, 1, 100)) return false;
    if ((value.x as number) + (value.width as number) > LAYOUT_COLUMNS) return false;
    return typeof value.visible === 'boolean' && isValidStyle(value.style);
  }

  return function validateLayoutTemplate(value: unknown): LayoutTemplate | null {
    if (!isRecord(value) || value.version !== 1 || !isValidCard(value.card) || !Array.isArray(value.blocks)) {
      return null;
    }
    if (value.blocks.length > 200) return null;
    if (!value.blocks.every(isValidBlock)) return null;
    const ids = value.blocks.map((block) => (block as LayoutBlock).id);
    if (new Set(ids).size !== ids.length) return null;
    return cloneLayoutTemplate(value as unknown as LayoutTemplate);
  };
}
