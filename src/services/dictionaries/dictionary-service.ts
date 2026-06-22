import { db } from '@/lib/db';
import { recordAuditEvent } from '@/services/audit/audit-service';
import { ServiceError } from '@/services/service-error';
import { normalizeDictionaryName } from './system-templates';

export type DictType = 'pileGrade' | 'drillingType' | 'downtimeReason';
export type DictFilter = 'active' | 'archived' | 'all';
export interface UsageCount { reportCount: number; planCount: number }
export type UsageMap = Record<string, UsageCount>;
export interface DictionaryUsage { pileGrade: UsageMap; drillingType: UsageMap; downtimeReason: UsageMap }

export interface CreateDictionaryItemInput {
  name: string;
  code?: string;
  lengthMm?: number | null;
  sectionOrDiameter?: string | null;
  notes?: string;
}

export interface DictionaryMutationContext {
  tenantId: string;
  actorId: string;
}

interface DictDelegate {
  findFirst(args: { where: { id: string; tenantId: string } }): Promise<{ id: string; name: string; isActive: boolean } | null>;
  update(args: {
    where: { id: string; tenantId: string };
    data: { name?: string; normalizedName?: string; isActive?: boolean };
  }): Promise<{ id: string }>;
  delete(args: { where: { id: string; tenantId: string } }): Promise<{ id: string }>;
}

const MODEL: Record<DictType, DictDelegate> = {
  pileGrade: db.pileGrade as unknown as DictDelegate,
  drillingType: db.drillingType as unknown as DictDelegate,
  downtimeReason: db.downtimeReason as unknown as DictDelegate,
};

function assertTenantId(tenantId: string): void {
  if (!tenantId) throw new ServiceError('Организация не определена', 403);
}

function assertLengthMm(lengthMm: number | null | undefined): void {
  if (lengthMm !== undefined && lengthMm !== null && (!Number.isInteger(lengthMm) || lengthMm < 0)) {
    throw new ServiceError('Длина должна быть неотрицательным целым числом (мм)', 400);
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

async function mapDuplicate<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new ServiceError('Элемент с таким названием уже существует', 409);
    }
    throw error;
  }
}

export async function listActiveDictionaries(tenantId: string) {
  assertTenantId(tenantId);
  const where = { tenantId, isActive: true };
  const [pileGrades, drillingTypes, downtimeReasons] = await Promise.all([
    db.pileGrade.findMany({ where, orderBy: { name: 'asc' } }),
    db.drillingType.findMany({ where, orderBy: { name: 'asc' } }),
    db.downtimeReason.findMany({ where, orderBy: { name: 'asc' } }),
  ]);

  return { pileGrades, drillingTypes, downtimeReasons };
}

export async function createDictionaryItem(
  context: DictionaryMutationContext,
  type: DictType,
  input: CreateDictionaryItemInput
) {
  const { tenantId, actorId } = context;
  assertTenantId(tenantId);
  const name = input.name?.trim();
  if (!name) throw new ServiceError('Название обязательно', 400);
  if (name.length > 100) throw new ServiceError('Название слишком длинное', 400);
  assertLengthMm(input.lengthMm);

  const normalizedName = normalizeDictionaryName(name);
  if (type === 'pileGrade') {
    const item = await mapDuplicate(() => db.pileGrade.create({
      data: {
        tenantId,
        name,
        normalizedName,
        code: input.code?.trim() || name,
        lengthMm: input.lengthMm ?? null,
        sectionOrDiameter: input.sectionOrDiameter?.trim() || null,
        notes: input.notes?.trim() || '',
      },
    }));
    await recordAuditEvent({
      action: 'dictionary.created', scope: 'dictionaries', actorId,
      targetId: item.id, tenantId, metadata: { type, after: item },
    });
    return item;
  }
  if (type === 'drillingType') {
    const item = await mapDuplicate(() => db.drillingType.create({ data: { tenantId, name, normalizedName } }));
    await recordAuditEvent({
      action: 'dictionary.created', scope: 'dictionaries', actorId,
      targetId: item.id, tenantId, metadata: { type, after: item },
    });
    return item;
  }
  if (type === 'downtimeReason') {
    const item = await mapDuplicate(() => db.downtimeReason.create({ data: { tenantId, name, normalizedName } }));
    await recordAuditEvent({
      action: 'dictionary.created', scope: 'dictionaries', actorId,
      targetId: item.id, tenantId, metadata: { type, after: item },
    });
    return item;
  }
  throw new ServiceError('Invalid type', 400);
}

/** Distinct-report + plan usage for a tenant-owned dictionary item. */
export async function getItemUsage(tenantId: string, type: DictType, id: string): Promise<UsageCount> {
  assertTenantId(tenantId);
  if (type === 'pileGrade') {
    const [reports, planCount] = await Promise.all([
      db.pileWork.findMany({
        where: { pileGradeId: id, report: { tenantId } },
        select: { reportId: true },
        distinct: ['reportId'],
      }),
      db.sitePilePlan.count({ where: { pileGradeId: id, site: { tenantId } } }),
    ]);
    return { reportCount: reports.length, planCount };
  }
  if (type === 'drillingType') {
    const reports = await db.leaderDrilling.findMany({
      where: { typeId: id, report: { tenantId } },
      select: { reportId: true },
      distinct: ['reportId'],
    });
    return { reportCount: reports.length, planCount: 0 };
  }
  const reports = await db.reportDowntime.findMany({
    where: { reasonId: id, report: { tenantId } },
    select: { reportId: true },
    distinct: ['reportId'],
  });
  return { reportCount: reports.length, planCount: 0 };
}

function countDistinctReports(rows: Array<Record<string, string>>, fk: string): UsageMap {
  const result: UsageMap = {};
  for (const row of rows) {
    const id = row[fk];
    if (!result[id]) result[id] = { reportCount: 0, planCount: 0 };
    result[id].reportCount += 1;
  }
  return result;
}

/** Batch usage counts limited to dictionary ids owned by one tenant. */
export async function getDictionaryUsage(tenantId: string): Promise<DictionaryUsage> {
  assertTenantId(tenantId);
  const [pileIds, drillingIds, downtimeIds] = await Promise.all([
    db.pileGrade.findMany({ where: { tenantId }, select: { id: true } }),
    db.drillingType.findMany({ where: { tenantId }, select: { id: true } }),
    db.downtimeReason.findMany({ where: { tenantId }, select: { id: true } }),
  ]);

  const [pileRows, drillRows, downtimeRows, planRows] = await Promise.all([
    db.pileWork.groupBy({ by: ['pileGradeId', 'reportId'], where: { pileGradeId: { in: pileIds.map(({ id }) => id) } } }),
    db.leaderDrilling.groupBy({ by: ['typeId', 'reportId'], where: { typeId: { in: drillingIds.map(({ id }) => id) } } }),
    db.reportDowntime.groupBy({ by: ['reasonId', 'reportId'], where: { reasonId: { in: downtimeIds.map(({ id }) => id) } } }),
    db.sitePilePlan.groupBy({ by: ['pileGradeId'], where: { pileGradeId: { in: pileIds.map(({ id }) => id) } }, _count: { _all: true } }),
  ]);

  const pileGrade = countDistinctReports(pileRows as Array<Record<string, string>>, 'pileGradeId');
  for (const plan of planRows as Array<{ pileGradeId: string; _count: { _all: number } }>) {
    if (!pileGrade[plan.pileGradeId]) pileGrade[plan.pileGradeId] = { reportCount: 0, planCount: 0 };
    pileGrade[plan.pileGradeId].planCount = plan._count._all;
  }

  return {
    pileGrade,
    drillingType: countDistinctReports(drillRows as Array<Record<string, string>>, 'typeId'),
    downtimeReason: countDistinctReports(downtimeRows as Array<Record<string, string>>, 'reasonId'),
  };
}

export async function listDictionaries(tenantId: string, filter: DictFilter) {
  assertTenantId(tenantId);
  const where = filter === 'all'
    ? { tenantId }
    : { tenantId, isActive: filter === 'active' };
  const opts = { where, orderBy: { name: 'asc' as const } };
  const [pileGrades, drillingTypes, downtimeReasons] = await Promise.all([
    db.pileGrade.findMany(opts),
    db.drillingType.findMany(opts),
    db.downtimeReason.findMany(opts),
  ]);
  return { pileGrades, drillingTypes, downtimeReasons };
}

async function setActive(
  context: DictionaryMutationContext,
  type: DictType,
  id: string,
  isActive: boolean
) {
  const { tenantId, actorId } = context;
  assertTenantId(tenantId);
  const model = MODEL[type];
  if (!model) throw new ServiceError('Invalid type', 400);
  const item = await model.findFirst({ where: { id, tenantId } });
  if (!item) throw new ServiceError('Элемент не найден', 404);
  const updated = await model.update({ where: { id, tenantId }, data: { isActive } });
  await recordAuditEvent({
    action: isActive ? 'dictionary.restored' : 'dictionary.archived',
    scope: 'dictionaries', actorId, targetId: id, tenantId,
    metadata: { type, before: item, after: { ...item, isActive } },
  });
  return updated;
}

export function archiveDictionaryItem(context: DictionaryMutationContext, type: DictType, id: string) {
  return setActive(context, type, id, false);
}

export function restoreDictionaryItem(context: DictionaryMutationContext, type: DictType, id: string) {
  return setActive(context, type, id, true);
}

export async function setPileGradeLength(
  context: DictionaryMutationContext,
  id: string,
  lengthMm: number | null
) {
  const { tenantId, actorId } = context;
  assertTenantId(tenantId);
  assertLengthMm(lengthMm);
  const item = await db.pileGrade.findFirst({ where: { id, tenantId } });
  if (!item) throw new ServiceError('Элемент не найден', 404);
  const updated = await db.pileGrade.update({ where: { id, tenantId }, data: { lengthMm } });
  await recordAuditEvent({
    action: 'dictionary.length_updated', scope: 'dictionaries', actorId,
    targetId: id, tenantId, metadata: { type: 'pileGrade', before: item, after: updated },
  });
  return updated;
}

export async function renameDictionaryItem(
  context: DictionaryMutationContext,
  type: DictType,
  id: string,
  name: string
) {
  const { tenantId, actorId } = context;
  assertTenantId(tenantId);
  const trimmed = name?.trim();
  if (!trimmed) throw new ServiceError('Название обязательно', 400);
  if (trimmed.length > 100) throw new ServiceError('Название слишком длинное', 400);
  const model = MODEL[type];
  if (!model) throw new ServiceError('Invalid type', 400);
  const item = await model.findFirst({ where: { id, tenantId } });
  if (!item) throw new ServiceError('Элемент не найден', 404);
  const usage = await getItemUsage(tenantId, type, id);
  if (usage.reportCount > 0 || usage.planCount > 0) {
    throw new ServiceError('Используемый элемент нельзя переименовать; архивируйте его и создайте новый', 409);
  }
  const updated = await mapDuplicate(() => model.update({
    where: { id, tenantId },
    data: { name: trimmed, normalizedName: normalizeDictionaryName(trimmed) },
  }));
  await recordAuditEvent({
    action: 'dictionary.renamed', scope: 'dictionaries', actorId,
    targetId: id, tenantId, metadata: { type, before: item, after: { ...item, name: trimmed } },
  });
  return updated;
}

/** Hard delete is allowed only for an unused item owned by the tenant. */
export async function deleteDictionaryItem(context: DictionaryMutationContext, type: DictType, id: string) {
  const { tenantId, actorId } = context;
  assertTenantId(tenantId);
  if (!type || !id) throw new ServiceError('type and id required', 400);
  const model = MODEL[type];
  if (!model) throw new ServiceError('Invalid type', 400);

  const item = await model.findFirst({ where: { id, tenantId } });
  if (!item) throw new ServiceError('Элемент не найден', 404);

  const usage = await getItemUsage(tenantId, type, id);
  if (usage.reportCount > 0 || usage.planCount > 0) {
    throw new ServiceError('Элемент используется и не может быть удалён', 409);
  }

  await model.delete({ where: { id, tenantId } });
  await recordAuditEvent({
    action: 'dictionary.deleted', scope: 'dictionaries', actorId,
    targetId: id, tenantId, metadata: { type, before: item },
  });
  return { success: true };
}
