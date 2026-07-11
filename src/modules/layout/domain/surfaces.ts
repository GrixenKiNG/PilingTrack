/**
 * Server-safe registry of editable layout surfaces.
 *
 * This is the allow-list: only surfaces declared here can be read or written
 * through /api/layout/[surfaceId]. Infrastructure/security screens (DLQ,
 * auth, admin-security) are deliberately NOT registered — adding a surface is
 * always an explicit decision, never a default.
 *
 * Two surface kinds share this registry, storage and API:
 *  - 'card-blocks' : a 12-col block grid inside one repeated card (stage 0+1)
 *  - 'page-layout' : an ordered list of widgets on a module page (stage B)
 * Each supplies its own default template + validator; the shape differs but
 * both persist as JSON in ModuleLayoutTemplate.
 */

import {
  DEFAULT_EQUIPMENT_TILE_TEMPLATE,
  EQUIPMENT_TILE_DATA_KEYS,
} from '@/components/piling/monitoring/equipment-tile-template';
import {
  DEFAULT_EQUIPMENT_CARD_TEMPLATE,
  EQUIPMENT_CARD_DATA_KEYS,
} from '@/components/piling/admin-equipment/equipment-card-template';
import { createTemplateValidator } from '@/components/piling/layout-editor/layout-template';
import { createPageLayoutValidator } from '@/components/piling/layout-editor/page-layout-template';
import {
  ANALYTICS_DASHBOARD_SURFACE_ID,
  ANALYTICS_DASHBOARD_WIDGET_IDS,
  DEFAULT_ANALYTICS_DASHBOARD_TEMPLATE,
} from '@/components/piling/analytics-dashboard/kpi-catalog';
import {
  MAIN_DASHBOARD_SURFACE_ID,
  MAIN_DASHBOARD_WIDGET_IDS,
  DEFAULT_MAIN_DASHBOARD_TEMPLATE,
} from '@/components/piling/main-dashboard/kpi-catalog';

export const MONITORING_EQUIPMENT_TILE_SURFACE_ID = 'monitoring-equipment-tile';
export const EQUIPMENT_CARD_SURFACE_ID = 'equipment-card';
export { ANALYTICS_DASHBOARD_SURFACE_ID, MAIN_DASHBOARD_SURFACE_ID };

export type LayoutSurfaceKind = 'card-blocks' | 'page-layout';

/** Any persisted template (card-blocks grid or page-layout widget list). */
export interface PersistedTemplate {
  version: number;
}

export interface LayoutSurfaceConfig {
  id: string;
  kind: LayoutSurfaceKind;
  defaultTemplate: PersistedTemplate;
  validate: (value: unknown) => PersistedTemplate | null;
}

const LAYOUT_SURFACES: Record<string, LayoutSurfaceConfig> = {
  [MONITORING_EQUIPMENT_TILE_SURFACE_ID]: {
    id: MONITORING_EQUIPMENT_TILE_SURFACE_ID,
    kind: 'card-blocks',
    defaultTemplate: DEFAULT_EQUIPMENT_TILE_TEMPLATE,
    validate: createTemplateValidator(EQUIPMENT_TILE_DATA_KEYS),
  },
  [EQUIPMENT_CARD_SURFACE_ID]: {
    id: EQUIPMENT_CARD_SURFACE_ID,
    kind: 'card-blocks',
    defaultTemplate: DEFAULT_EQUIPMENT_CARD_TEMPLATE,
    validate: createTemplateValidator(EQUIPMENT_CARD_DATA_KEYS),
  },
  [ANALYTICS_DASHBOARD_SURFACE_ID]: {
    id: ANALYTICS_DASHBOARD_SURFACE_ID,
    kind: 'page-layout',
    defaultTemplate: DEFAULT_ANALYTICS_DASHBOARD_TEMPLATE,
    validate: createPageLayoutValidator(ANALYTICS_DASHBOARD_WIDGET_IDS),
  },
  [MAIN_DASHBOARD_SURFACE_ID]: {
    id: MAIN_DASHBOARD_SURFACE_ID,
    kind: 'page-layout',
    defaultTemplate: DEFAULT_MAIN_DASHBOARD_TEMPLATE,
    validate: createPageLayoutValidator(MAIN_DASHBOARD_WIDGET_IDS),
  },
};

export function getSurfaceConfig(surfaceId: string): LayoutSurfaceConfig | null {
  return Object.prototype.hasOwnProperty.call(LAYOUT_SURFACES, surfaceId)
    ? LAYOUT_SURFACES[surfaceId]
    : null;
}
