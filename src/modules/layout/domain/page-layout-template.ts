/**
 * Page-layout template model for the shared module layout editor (Stage B).
 *
 * A `page-layout` surface is an ordered list of WIDGETS placed on a module
 * page (which appear, in what order, at what size). This is a different shape
 * from the `card-blocks` 12-col block grid — its own type, validator and
 * editor/renderer — but it reuses the same storage, registry and
 * /api/layout/[surfaceId]. Pure module (no React): safe to import from API
 * routes.
 */

export type WidgetSize = 'sm' | 'md' | 'lg';

export const WIDGET_SIZES: readonly WidgetSize[] = ['sm', 'md', 'lg'];

export interface PageWidgetPlacement {
  /** Must exist in the surface's widget catalog. */
  id: string;
  visible: boolean;
  size: WidgetSize;
  /** Ascending render order. */
  order: number;
  /** Per-widget options, validated by the widget itself at render time. */
  settings?: Record<string, unknown>;
}

export interface PageLayoutTemplate {
  version: 1;
  widgets: PageWidgetPlacement[];
}

const SIZES = new Set<WidgetSize>(WIDGET_SIZES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function clonePageLayoutTemplate(template: PageLayoutTemplate): PageLayoutTemplate {
  return JSON.parse(JSON.stringify(template)) as PageLayoutTemplate;
}

export type PageLayoutValidator = (value: unknown) => PageLayoutTemplate | null;

/**
 * Build a validator bound to a surface's widget catalog. Widget ids outside
 * the catalog are rejected (the catalog is the allow-list). Caps keep the
 * JSONB row small: <=100 widgets, settings serialized <=4000 chars.
 */
export function createPageLayoutValidator(catalogIds: readonly string[]): PageLayoutValidator {
  const allowed = new Set(catalogIds);

  function isValidWidget(value: unknown): value is PageWidgetPlacement {
    if (!isRecord(value)) return false;
    if (typeof value.id !== 'string' || !allowed.has(value.id)) return false;
    if (typeof value.visible !== 'boolean') return false;
    if (typeof value.size !== 'string' || !SIZES.has(value.size as WidgetSize)) return false;
    if (!Number.isInteger(value.order) || (value.order as number) < 0 || (value.order as number) > 999) return false;
    if (value.settings !== undefined) {
      if (!isRecord(value.settings)) return false;
      if (JSON.stringify(value.settings).length > 4000) return false;
    }
    return true;
  }

  return function validatePageLayout(value: unknown): PageLayoutTemplate | null {
    if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.widgets)) return null;
    if (value.widgets.length > 100) return null;
    if (!value.widgets.every(isValidWidget)) return null;
    const ids = value.widgets.map((w) => (w as PageWidgetPlacement).id);
    if (new Set(ids).size !== ids.length) return null;
    return clonePageLayoutTemplate(value as unknown as PageLayoutTemplate);
  };
}
