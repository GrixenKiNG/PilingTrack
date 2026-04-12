import { db } from '@/lib/db';
import { ServiceError } from '@/services/service-error';

export async function listActiveDictionaries() {
  const [pileGrades, drillingTypes, downtimeReasons] = await Promise.all([
    db.pileGrade.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
    db.drillingType.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
    db.downtimeReason.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
  ]);

  return { pileGrades, drillingTypes, downtimeReasons };
}

export async function createDictionaryItem(type: string, name: string) {
  if (!type || !name?.trim()) {
    throw new ServiceError('type and name required', 400);
  }

  if (type === 'pileGrade') {
    return db.pileGrade.create({ data: { name: name.trim() } });
  }

  if (type === 'drillingType') {
    return db.drillingType.create({ data: { name: name.trim() } });
  }

  if (type === 'downtimeReason') {
    return db.downtimeReason.create({ data: { name: name.trim() } });
  }

  throw new ServiceError('Invalid type', 400);
}

export async function deleteDictionaryItem(type: string, id: string) {
  if (!type || !id) {
    throw new ServiceError('type and id required', 400);
  }

  // Soft delete — prevents FK constraint violations
  // Items linked to reports/history remain valid
  if (type === 'pileGrade') {
    const item = await db.pileGrade.findUnique({ where: { id } });
    if (!item || !item.isActive) {
      throw new ServiceError('PileGrade not found or already deactivated', 404);
    }
    await db.pileGrade.update({ where: { id }, data: { isActive: false } });
    return { success: true };
  }

  if (type === 'drillingType') {
    const item = await db.drillingType.findUnique({ where: { id } });
    if (!item || !item.isActive) {
      throw new ServiceError('DrillingType not found or already deactivated', 404);
    }
    await db.drillingType.update({ where: { id }, data: { isActive: false } });
    return { success: true };
  }

  if (type === 'downtimeReason') {
    const item = await db.downtimeReason.findUnique({ where: { id } });
    if (!item || !item.isActive) {
      throw new ServiceError('DowntimeReason not found or already deactivated', 404);
    }
    await db.downtimeReason.update({ where: { id }, data: { isActive: false } });
    return { success: true };
  }

  throw new ServiceError('Invalid type', 400);
}
