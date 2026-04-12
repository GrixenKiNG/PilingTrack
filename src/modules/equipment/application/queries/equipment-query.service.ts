import { db } from '@/lib/db';
import type { CursorPaginationResult } from '@/lib/pagination-cursor';

export async function getAccessibleEquipment() { return db.equipment.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }); }
export async function getEquipmentById(id: string) { return db.equipment.findUnique({ where: { id }, include: { crews: { select: { id: true, name: true, siteId: true } } } }); }
export async function listAllEquipment(pagination?: CursorPaginationResult, siteId?: string | null) {
  const take = pagination?.take ?? 50;
  const cursor = pagination?.cursor ?? undefined;
  const where: Record<string, unknown> = {};
  if (siteId) {
    where.crews = { some: { siteId } };
  }
  return db.equipment.findMany({
    where,
    select: { id: true, name: true, model: true, qty: true, isActive: true },
    orderBy: { name: 'asc' },
    cursor: cursor ? { id: cursor } : undefined,
    take: take + 1,
    skip: cursor ? 1 : 0,
  });
}
