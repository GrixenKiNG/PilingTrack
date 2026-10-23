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
  validateEquipmentTileTemplate,
  type EquipmentTileTemplate,
} from './equipment-tile-template';
import {
  DEFAULT_EQUIPMENT_CARD_TEMPLATE,
  validateEquipmentCardTemplate,
  type EquipmentCardTemplate,
} from './equipment-card-template';
import type { LayoutTemplate } from './layout-template';
import type { PageLayoutTemplate } from './page-layout-template';
import { createPageLayoutValidator } from './page-layout-template';
import {
  ANALYTICS_DASHBOARD_SURFACE_ID,
  ANALYTICS_DASHBOARD_WIDGET_IDS,
  DEFAULT_ANALYTICS_DASHBOARD_TEMPLATE,
} from './analytics-dashboard-catalog';
import {
  MAIN_DASHBOARD_SURFACE_ID,
  MAIN_DASHBOARD_WIDGET_IDS,
  DEFAULT_MAIN_DASHBOARD_TEMPLATE,
} from './main-dashboard-catalog';

export const MONITORING_EQUIPMENT_TILE_SURFACE_ID = 'monitoring-equipment-tile';
export const EQUIPMENT_CARD_SURFACE_ID = 'equipment-card';
export { ANALYTICS_DASHBOARD_SURFACE_ID, MAIN_DASHBOARD_SURFACE_ID };

export type LayoutSurfaceKind = 'card-blocks' | 'page-layout';

/** Surface identifiers determine the stored template shape. */
export interface SurfaceTemplateMap {
  [MONITORING_EQUIPMENT_TILE_SURFACE_ID]: EquipmentTileTemplate;
  [EQUIPMENT_CARD_SURFACE_ID]: EquipmentCardTemplate;
  [ANALYTICS_DASHBOARD_SURFACE_ID]: PageLayoutTemplate;
  [MAIN_DASHBOARD_SURFACE_ID]: PageLayoutTemplate;
}
export type SurfaceId = keyof SurfaceTemplateMap;
export type PersistedTemplate = SurfaceTemplateMap[SurfaceId];
type SurfaceConfig<S extends SurfaceId> = {
  id: S;
  kind: SurfaceTemplateMap[S] extends LayoutTemplate ? 'card-blocks' : 'page-layout';
  defaultTemplate: SurfaceTemplateMap[S];
  validate: (value: unknown) => SurfaceTemplateMap[S] | null;
};
export type LayoutSurfaceConfig = { [S in SurfaceId]: SurfaceConfig<S> }[SurfaceId];

const LAYOUT_SURFACES: { [S in SurfaceId]: SurfaceConfig<S> } = {
  [MONITORING_EQUIPMENT_TILE_SURFACE_ID]: {
    id: MONITORING_EQUIPMENT_TILE_SURFACE_ID,
    kind: 'card-blocks',
    defaultTemplate: DEFAULT_EQUIPMENT_TILE_TEMPLATE,
    validate: validateEquipmentTileTemplate,
  },
  [EQUIPMENT_CARD_SURFACE_ID]: {
    id: EQUIPMENT_CARD_SURFACE_ID,
    kind: 'card-blocks',
    defaultTemplate: DEFAULT_EQUIPMENT_CARD_TEMPLATE,
    validate: validateEquipmentCardTemplate,
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

export function getSurfaceConfig<S extends SurfaceId>(surfaceId: S): SurfaceConfig<S>;
export function getSurfaceConfig(surfaceId: string): LayoutSurfaceConfig | null;
export function getSurfaceConfig(surfaceId: string): LayoutSurfaceConfig | null {
  switch (surfaceId) {
    case MONITORING_EQUIPMENT_TILE_SURFACE_ID: return LAYOUT_SURFACES[surfaceId];
    case EQUIPMENT_CARD_SURFACE_ID: return LAYOUT_SURFACES[surfaceId];
    case ANALYTICS_DASHBOARD_SURFACE_ID: return LAYOUT_SURFACES[surfaceId];
    case MAIN_DASHBOARD_SURFACE_ID: return LAYOUT_SURFACES[surfaceId];
    default: return null;
  }
}
