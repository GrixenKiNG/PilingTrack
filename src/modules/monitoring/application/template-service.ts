import { db } from '@/lib/db';
import {
  cloneEquipmentTileTemplate,
  DEFAULT_EQUIPMENT_TILE_TEMPLATE,
  validateEquipmentTileTemplate,
  type EquipmentTileTemplate,
} from '@/components/piling/monitoring/equipment-tile-template';

export async function getTemplate(tenantId: string): Promise<EquipmentTileTemplate> {
  if (!tenantId) throw new Error('getTemplate: tenantId is required'); // fail closed
  const row = await db.monitoringTileTemplate.findUnique({ where: { tenantId } });
  if (!row) return cloneEquipmentTileTemplate(DEFAULT_EQUIPMENT_TILE_TEMPLATE);
  return validateEquipmentTileTemplate(row.template) ?? cloneEquipmentTileTemplate(DEFAULT_EQUIPMENT_TILE_TEMPLATE);
}

export async function saveTemplate(
  tenantId: string,
  template: unknown,
  updatedBy: string,
): Promise<EquipmentTileTemplate> {
  if (!tenantId) throw new Error('saveTemplate: tenantId is required'); // fail closed
  const validated = validateEquipmentTileTemplate(template);
  if (!validated) throw new TypeError('Invalid equipment tile template');
  await db.monitoringTileTemplate.upsert({
    where: { tenantId },
    create: { tenantId, template: validated as object, updatedBy },
    update: { template: validated as object, updatedBy },
  });
  return validated;
}
