/**
 * Layout module facade — the public boundary for per-tenant, per-surface
 * persisted layout templates (shared module layout editor).
 */

export {
  getLayout,
  getLayoutSnapshot,
  saveLayoutSnapshot,
  LayoutConflictError,
  EMPTY_LAYOUT_REVISION,
  type LayoutSnapshot,
  getLayoutSet,
  saveLayout,
  deleteLayout,
  BASE_ENTITY,
  UnknownSurfaceError,
  type LayoutSet,
} from './application/layout-service';
export {
  getSurfaceConfig,
  MONITORING_EQUIPMENT_TILE_SURFACE_ID,
  EQUIPMENT_CARD_SURFACE_ID,
  type LayoutSurfaceConfig,
  type SurfaceId,
  type SurfaceTemplateMap,
} from './domain/surfaces';
