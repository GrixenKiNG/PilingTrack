import { db } from '@/lib/db';
import { ServiceError } from '@/services/service-error';
import type { CursorPaginationResult } from '@/lib/pagination-cursor';

export async function getAccessibleEquipment() { return db.equipment.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }); }
export async function getEquipmentById(id: string) { return db.equipment.findUnique({ where: { id }, include: { crews: { select: { id: true, name: true, siteId: true } } } }); }

export async function getEquipmentByIdOrThrow(id: string) {
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
  if (!equipment) throw new ServiceError('Equipment not found', 404);
  return equipment;
}

export async function listEquipmentWithCrewCounts() {
  const list = await db.equipment.findMany({
    include: { crews: { where: { isActive: true } } },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
  });
  return list.map((eq) => ({
    id: eq.id, name: eq.name, model: eq.model, qty: eq.qty,
    isActive: eq.isActive, description: eq.description,
    crewCount: eq.crews.length,
  }));
}
export async function listEquipmentCatalog() {
  return db.equipment.findMany({ orderBy: { name: 'asc' } });
}

export async function listAllEquipment(pagination?: CursorPaginationResult, siteId?: string | null) {
  const take = pagination?.take ?? 50;
  const cursor = pagination?.cursor ?? undefined;
  const where: Record<string, unknown> = {};
  
  // Always include all equipment, but optionally filter by associated sites via crews
  // Don't filter if siteId is provided - return all equipment as it can be assigned to any site
  
  return db.equipment.findMany({
    where,
    select: { id: true, name: true, model: true, qty: true, isActive: true },
    orderBy: { name: 'asc' },
    cursor: cursor ? { id: cursor } : undefined,
    take: take + 1,
    skip: cursor ? 1 : 0,
  });
}
