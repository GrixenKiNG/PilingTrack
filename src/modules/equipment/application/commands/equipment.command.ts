import type { EquipmentMetadataInput } from '@/lib/validation-schemas';
export interface CreateEquipmentCommand {
  name: string; model?: string; qty?: number; description?: string; userId?: string; tenantId: string;
}
export interface UpdateEquipmentCommand {
  expectedUpdatedAt?: string; metadata?: Partial<EquipmentMetadataInput>; allowDecrease?: boolean;
  equipmentId: string; name?: string; model?: string; qty?: number; description?: string; isActive?: boolean; userId?: string; tenantId: string;
}
