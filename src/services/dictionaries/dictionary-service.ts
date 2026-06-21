import { db } from '@/lib/db';
import { ServiceError } from '@/services/service-error';
import { lengthMmFromGradeName } from '@/lib/pile-length';

export type DictType = 'pileGrade' | 'drillingType' | 'downtimeReason';
export type DictFilter = 'active' | 'archived' | 'all';
export interface UsageCount { reportCount: number; planCount: number }
export type UsageMap = Record<string, UsageCount>;
export interface DictionaryUsage { pileGrade: UsageMap; drillingType: UsageMap; downtimeReason: UsageMap }

// Minimal structural view of the three dictionary delegates. Prisma's generated
// delegates have incompatible generic overloads, so a union can't be called
// generically — this interface exposes exactly the methods these helpers use.
interface DictDelegate {
  findUnique(args: { where: { id: string } }): Promise<{ id: string; name: string; isActive: boolean } | null>;
  update(args: { where: { id: string }; data: { name?: string; isActive?: boolean } }): Promise<{ id: string }>;
  delete(args: { where: { id: string } }): Promise<{ id: string }>;
}

const MODEL: Record<DictType, DictDelegate> = {
  pileGrade: db.pileGrade as unknown as DictDelegate,
  drillingType: db.drillingType as unknown as DictDelegate,
  downtimeReason: db.downtimeReason as unknown as DictDelegate,
};

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
    const trimmed = name.trim();
    // Seed the stored length from the name once (e.g. "С300" -> 30000 mm);
    // admins can correct it afterwards via setPileGradeLength. null when the
    // name has no parseable length — never a silently-wrong default.
    return db.pileGrade.create({ data: { name: trimmed, lengthMm: lengthMmFromGradeName(trimmed) } });
  }

  if (type === 'drillingType') {
    return db.drillingType.create({ data: { name: name.trim() } });
  }

  if (type === 'downtimeReason') {
    return db.downtimeReason.create({ data: { name: name.trim() } });
  }

  throw new ServiceError('Invalid type', 400);
}

/** Distinct-report + plan usage for a single dictionary item. */
export async function getItemUsage(type: DictType, id: string): Promise<UsageCount> {
  if (type === 'pileGrade') {
    const [reports, planCount] = await Promise.all([
      db.pileWork.findMany({ where: { pileGradeId: id }, select: { reportId: true }, distinct: ['reportId'] }),
      db.sitePilePlan.count({ where: { pileGradeId: id } }),
    ]);
    return { reportCount: reports.length, planCount };
  }
  if (type === 'drillingType') {
    const reports = await db.leaderDrilling.findMany({ where: { typeId: id }, select: { reportId: true }, distinct: ['reportId'] });
    return { reportCount: reports.length, planCount: 0 };
  }
  const reports = await db.reportDowntime.findMany({ where: { reasonId: id }, select: { reportId: true }, distinct: ['reportId'] });
  return { reportCount: reports.length, planCount: 0 };
}

function countDistinctReports(rows: Array<Record<string, string>>, fk: string): UsageMap {
  const m: UsageMap = {};
  for (const r of rows) {
    const id = r[fk];
    if (!m[id]) m[id] = { reportCount: 0, planCount: 0 };
    m[id].reportCount += 1;
  }
  return m;
}

/** Batch usage counts for the admin registry feed (one grouped query per source). */
export async function getDictionaryUsage(): Promise<DictionaryUsage> {
  const [pileRows, drillRows, downtimeRows, planRows] = await Promise.all([
    db.pileWork.groupBy({ by: ['pileGradeId', 'reportId'] }),
    db.leaderDrilling.groupBy({ by: ['typeId', 'reportId'] }),
    db.reportDowntime.groupBy({ by: ['reasonId', 'reportId'] }),
    db.sitePilePlan.groupBy({ by: ['pileGradeId'], _count: { _all: true } }),
  ]);

  const pileGrade = countDistinctReports(pileRows as Array<Record<string, string>>, 'pileGradeId');
  for (const p of planRows as Array<{ pileGradeId: string; _count: { _all: number } }>) {
    if (!pileGrade[p.pileGradeId]) pileGrade[p.pileGradeId] = { reportCount: 0, planCount: 0 };
    pileGrade[p.pileGradeId].planCount = p._count._all;
  }

  return {
    pileGrade,
    drillingType: countDistinctReports(drillRows as Array<Record<string, string>>, 'typeId'),
    downtimeReason: countDistinctReports(downtimeRows as Array<Record<string, string>>, 'reasonId'),
  };
}

export async function listDictionaries(filter: DictFilter) {
  const where = filter === 'all' ? {} : { isActive: filter === 'active' };
  const opts = { where, orderBy: { name: 'asc' as const } };
  const [pileGrades, drillingTypes, downtimeReasons] = await Promise.all([
    db.pileGrade.findMany(opts),
    db.drillingType.findMany(opts),
    db.downtimeReason.findMany(opts),
  ]);
  return { pileGrades, drillingTypes, downtimeReasons };
}

async function setActive(type: DictType, id: string, isActive: boolean) {
  const model = MODEL[type];
  if (!model) throw new ServiceError('Invalid type', 400);
  const item = await model.findUnique({ where: { id } });
  if (!item) throw new ServiceError('Элемент не найден', 404);
  return model.update({ where: { id }, data: { isActive } });
}

export function archiveDictionaryItem(type: DictType, id: string) { return setActive(type, id, false); }
export function restoreDictionaryItem(type: DictType, id: string) { return setActive(type, id, true); }

/** Set the stored pile length (mm) for a grade. null = unknown. */
export async function setPileGradeLength(id: string, lengthMm: number | null) {
  if (lengthMm !== null && (!Number.isInteger(lengthMm) || lengthMm < 0)) {
    throw new ServiceError('Длина должна быть неотрицательным целым числом (мм)', 400);
  }
  const item = await db.pileGrade.findUnique({ where: { id } });
  if (!item) throw new ServiceError('Элемент не найден', 404);
  return db.pileGrade.update({ where: { id }, data: { lengthMm } });
}

export async function renameDictionaryItem(type: DictType, id: string, name: string) {
  const trimmed = name?.trim();
  if (!trimmed) throw new ServiceError('Название обязательно', 400);
  if (trimmed.length > 100) throw new ServiceError('Название слишком длинное', 400);
  const model = MODEL[type];
  if (!model) throw new ServiceError('Invalid type', 400);
  const item = await model.findUnique({ where: { id } });
  if (!item) throw new ServiceError('Элемент не найден', 404);
  return model.update({ where: { id }, data: { name: trimmed } });
}

/** Hard delete — only when the item is referenced nowhere. */
export async function deleteDictionaryItem(type: DictType, id: string) {
  if (!type || !id) throw new ServiceError('type and id required', 400);
  const model = MODEL[type];
  if (!model) throw new ServiceError('Invalid type', 400);

  const item = await model.findUnique({ where: { id } });
  if (!item) throw new ServiceError('Элемент не найден', 404);

  const usage = await getItemUsage(type, id);
  if (usage.reportCount > 0 || usage.planCount > 0) {
    throw new ServiceError('Элемент используется и не может быть удалён', 409);
  }

  await model.delete({ where: { id } });
  return { success: true };
}
