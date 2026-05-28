export interface CreateEquipmentCommand {
  name: string; model?: string; qty?: number; description?: string; userId?: string; tenantId: string;
}
export interface UpdateEquipmentCommand {
  equipmentId: string; name?: string; model?: string; qty?: number; description?: string; userId?: string; tenantId: string;
}
