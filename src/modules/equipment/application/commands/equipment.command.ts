export interface CreateEquipmentCommand { name: string; model?: string; qty?: number; description?: string; userId?: string; }
export interface UpdateEquipmentCommand { equipmentId: string; name?: string; model?: string; qty?: number; description?: string; userId?: string; }
