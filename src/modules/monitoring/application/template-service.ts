/**
 * Monitoring tile template — thin alias over the shared layout service
 * (surface 'monitoring-equipment-tile'). Kept so the legacy
 * /api/monitoring/template route and existing callers keep working while
 * clients migrate to /api/layout/[surfaceId].
 */

import type { EquipmentTileTemplate } from '@/modules/layout/client';
import { getLayout, saveLayout } from '@/modules/layout';
import { MONITORING_EQUIPMENT_TILE_SURFACE_ID } from '@/modules/layout';

export async function getTemplate(tenantId: string): Promise<EquipmentTileTemplate> {
  return getLayout(tenantId, MONITORING_EQUIPMENT_TILE_SURFACE_ID);
}

export async function saveTemplate(
  tenantId: string,
  template: unknown,
  updatedBy: string,
  expectedRevision?: string | null,
): Promise<EquipmentTileTemplate> {
  return saveLayout(tenantId, MONITORING_EQUIPMENT_TILE_SURFACE_ID, template, updatedBy, undefined, expectedRevision);
}
