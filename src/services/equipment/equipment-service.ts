import { db } from '@/lib/db';
import { ServiceError } from '@/services/service-error';

export async function listEquipmentWithCrewCounts() {
  const equipmentList = await db.equipment.findMany({
    include: {
      crews: { where: { isActive: true } },
    },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
  });

  return equipmentList.map((equipment) => ({
    id: equipment.id,
    name: equipment.name,
    model: equipment.model,
    qty: equipment.qty,
    isActive: equipment.isActive,
    description: equipment.description,
    crewCount: equipment.crews.length,
  }));
}

export async function listEquipmentCatalog() {
  return db.equipment.findMany({
    orderBy: { name: 'asc' },
  });
}

export async function getEquipmentById(id: string) {
  const equipment = await db.equipment.findUnique({
    where: { id },
    include: {
      crews: {
        where: { isActive: true },
        include: {
          operator: { select: { id: true, name: true } },
          site: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!equipment) {
    throw new ServiceError('Equipment not found', 404);
  }

  return equipment;
}

export async function createEquipment(input: {
  name: string;
  model?: string;
  qty?: number;
  description?: string;
}) {
  const name = String(input.name || '').trim();
  const model = String(input.model || '').trim();
  const qty = input.qty !== undefined ? Number(input.qty) : 1;

  if (!name) {
    throw new ServiceError('Name required', 400);
  }

  if (!model) {
    throw new ServiceError('Model required', 400);
  }

  if (name.length > 200 || model.length > 200) {
    throw new ServiceError('Name and model must be 1-200 characters', 400);
  }

  if (!Number.isFinite(qty) || qty < 1) {
    throw new ServiceError('Quantity must be >= 1', 400);
  }

  return db.equipment.create({
    data: {
      name,
      model,
      qty,
      description: String(input.description || '').trim(),
    },
  });
}

export async function updateEquipment(
  id: string,
  input: {
    name?: string;
    model?: string;
    qty?: number;
    isActive?: boolean;
    description?: string;
  }
) {
  if (!id) {
    throw new ServiceError('ID required', 400);
  }

  const existing = await db.equipment.findUnique({ where: { id } });
  if (!existing) {
    throw new ServiceError('Equipment not found', 404);
  }

  const data: Record<string, unknown> = {};

  if (input.name !== undefined) {
    const name = String(input.name).trim();
    if (!name || name.length > 200) {
      throw new ServiceError('Name must be 1-200 characters', 400);
    }
    data.name = name;
  }

  if (input.model !== undefined) {
    const model = String(input.model).trim();
    if (!model || model.length > 200) {
      throw new ServiceError('Model must be 1-200 characters', 400);
    }
    data.model = model;
  }

  if (input.qty !== undefined) {
    const qty = Number(input.qty);
    if (!Number.isFinite(qty) || qty < 1) {
      throw new ServiceError('Quantity must be >= 1', 400);
    }
    data.qty = qty;
  }

  if (input.isActive !== undefined) {
    data.isActive = Boolean(input.isActive);
  }

  if (input.description !== undefined) {
    data.description = String(input.description).trim();
  }

  return db.equipment.update({
    where: { id },
    data,
  });
}

export async function deleteEquipment(id: string) {
  if (!id) {
    throw new ServiceError('ID required', 400);
  }

  const existing = await db.equipment.findUnique({
    where: { id },
    include: {
      crews: { where: { isActive: true } },
    },
  });
  if (!existing) {
    throw new ServiceError('Equipment not found', 404);
  }

  if (existing.crews.length > 0) {
    throw new ServiceError('Cannot delete equipment with linked active crews', 409);
  }

  try {
    await db.equipment.delete({ where: { id } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal error';
    if (message.includes('FOREIGN KEY')) {
      throw new ServiceError('Cannot delete equipment with linked crews or reports', 409);
    }
    throw error;
  }

  return { success: true };
}
