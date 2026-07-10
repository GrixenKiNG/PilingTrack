/**
 * Server-safe registry of editable layout surfaces.
 *
 * This is the allow-list: only surfaces declared here can be read or written
 * through /api/layout/[surfaceId]. Infrastructure/security screens (DLQ,
 * auth, admin-security) are deliberately NOT registered — adding a surface is
 * always an explicit decision, never a default.
 *
 * Client-side rendering catalogs (how each dataKey renders) live next to the
 * owning module's components; this registry only knows defaults + validation.
 */

import {
  DEFAULT_EQUIPMENT_TILE_TEMPLATE,
  EQUIPMENT_TILE_DATA_KEYS,
} from '@/components/piling/monitoring/equipment-tile-template';
import {
  DEFAULT_EQUIPMENT_CARD_TEMPLATE,
  EQUIPMENT_CARD_DATA_KEYS,
} from '@/components/piling/admin-equipment/equipment-card-template';
import {
  createTemplateValidator,
  type LayoutTemplate,
  type LayoutTemplateValidator,
} from '@/components/piling/layout-editor/layout-template';

export const MONITORING_EQUIPMENT_TILE_SURFACE_ID = 'monitoring-equipment-tile';
export const EQUIPMENT_CARD_SURFACE_ID = 'equipment-card';

export interface LayoutSurfaceConfig {
  id: string;
  defaultTemplate: LayoutTemplate;
  validate: LayoutTemplateValidator;
}

const LAYOUT_SURFACES: Record<string, LayoutSurfaceConfig> = {
  [MONITORING_EQUIPMENT_TILE_SURFACE_ID]: {
    id: MONITORING_EQUIPMENT_TILE_SURFACE_ID,
    defaultTemplate: DEFAULT_EQUIPMENT_TILE_TEMPLATE,
    validate: createTemplateValidator(EQUIPMENT_TILE_DATA_KEYS),
  },
  [EQUIPMENT_CARD_SURFACE_ID]: {
    id: EQUIPMENT_CARD_SURFACE_ID,
    defaultTemplate: DEFAULT_EQUIPMENT_CARD_TEMPLATE,
    validate: createTemplateValidator(EQUIPMENT_CARD_DATA_KEYS),
  },
};

export function getSurfaceConfig(surfaceId: string): LayoutSurfaceConfig | null {
  return Object.prototype.hasOwnProperty.call(LAYOUT_SURFACES, surfaceId)
    ? LAYOUT_SURFACES[surfaceId]
    : null;
}
