/**
 * Layout module facade — the public boundary for per-tenant, per-surface
 * persisted layout templates (shared module layout editor).
 */

export { getLayout, saveLayout, UnknownSurfaceError } from './application/layout-service';
export {
  getSurfaceConfig,
  MONITORING_EQUIPMENT_TILE_SURFACE_ID,
  EQUIPMENT_CARD_SURFACE_ID,
  type LayoutSurfaceConfig,
} from './domain/surfaces';
