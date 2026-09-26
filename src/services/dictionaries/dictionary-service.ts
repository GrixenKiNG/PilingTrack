import { db } from '@/lib/db';
import { recordAuditEvent } from '@/services/audit/audit-service';
import { ServiceError } from '@/services/service-error';
import { normalizeDictionaryName } from './system-templates';

export type DictType = 'pileGrade' | 'drillingType' | 'downtimeReason';
export type DictFilter = 'active' | 'archived' | 'all';
export interface UsageCount { reportCount: number; planCount: number; siteCount: number }
export type UsageMap = Record<string, UsageCount>;
export interface DictionaryUsage { pileGrade: UsageMap; drillingType: UsageMap; downtimeReason: UsageMap; siteTotals?: Record<DictType, number> }

/** Distinct real sites touched by any row of one kind (for "Используются в N объектах"). */
function distinctSites(rows: Array<Record<string, string>>, reportSite: Map<string, string>): number {
  const sites = new Set<string>();
  for (const row of rows) { const s = reportSite.get(row.reportId); if (s) sites.add(s); }
  return sites.size;
}

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
    data: { name?: string; normalizedName?: string; isActive?: boolean; archivedAt?: Date | null };
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

/**
 * Ноль запрещён, `null` — нет.
 *
 * Свай нулевой длины не бывает, а последствия у нуля тяжёлые: длина марки
 * не хранится в отчёте, её берут живьём все потребители — аналитика объекта и
 * техники, журнал забивки, печатные формы за прошлые периоды. Ноль обнулил бы
 * погонные метры везде и задним числом. Форма положительное число и требовала,
 * а схема маршрута допускала `min(0)` — то есть защита стояла только на экране.
 *
 * `null` — «длина не задана» у марок, где её не завели. Для уже используемой
 * марки `null` недопустим: его отсекает `setPileGradeLength` до этой проверки.
 */
function assertLengthMm(lengthMm: number | null | undefined): void {
  if (lengthMm !== undefined && lengthMm !== null && (!Number.isInteger(lengthMm) || lengthMm <= 0)) {
    throw new ServiceError('Длина сваи должна быть целым числом больше нуля (мм)', 400);
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

/** One row per distinct site of the reports that mention a dictionary item. */
type SiteGroup = { _count: { _all: number } };

/**
 * Отчёты группируются по объекту в БД: у каждого отчёта ровно один объект,
 * поэтому сумма `_count._all` — это число отчётов, а число групп — число объектов.
 * Считать то же в JS означало читать все строки забивки/бурения/простоев тенанта
 * за все годы ради двух DISTINCT (находка F-R20-3).
 */
function usageFromSiteGroups(groups: SiteGroup[], planCount: number): UsageCount {
  return {
    reportCount: groups.reduce((total, group) => total + group._count._all, 0),
    planCount,
    siteCount: groups.length,
  };
}

/** Distinct-report + plan usage for a tenant-owned dictionary item. */
export async function getItemUsage(tenantId: string, type: DictType, id: string): Promise<UsageCount> {
  assertTenantId(tenantId);
  if (type === 'pileGrade') {
    const [siteGroups, planCount] = await Promise.all([
      db.report.groupBy({
        by: ['siteId'],
        where: { tenantId, piles: { some: { pileGradeId: id } } },
        _count: { _all: true },
      }),
      db.sitePilePlan.count({ where: { pileGradeId: id, site: { tenantId } } }),
    ]);
    return usageFromSiteGroups(siteGroups, planCount);
  }
  if (type === 'drillingType') {
    const siteGroups = await db.report.groupBy({
      by: ['siteId'],
      where: { tenantId, drillings: { some: { typeId: id } } },
      _count: { _all: true },
    });
    return usageFromSiteGroups(siteGroups, 0);
  }
  const siteGroups = await db.report.groupBy({
    by: ['siteId'],
    where: { tenantId, downtimes: { some: { reasonId: id } } },
    _count: { _all: true },
  });
  return usageFromSiteGroups(siteGroups, 0);
}

function aggregateUsage(
  rows: Array<Record<string, string>>,
  fk: string,
  reportSite: Map<string, string>,
): UsageMap {
  const result: UsageMap = {};
  const sites: Record<string, Set<string>> = {};
  for (const row of rows) {
    const id = row[fk];
    if (!result[id]) { result[id] = { reportCount: 0, planCount: 0, siteCount: 0 }; sites[id] = new Set(); }
    result[id].reportCount += 1;
    const siteId = reportSite.get(row.reportId);
    if (siteId) sites[id].add(siteId);
  }
  for (const id of Object.keys(result)) result[id].siteCount = sites[id].size;
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

  // Resolve reportId → siteId once, so "objects" counts are distinct real sites (no fake data).
  const reportIds = [...new Set([...pileRows, ...drillRows, ...downtimeRows].map((r) => (r as { reportId: string }).reportId))];
  const reports = reportIds.length
    ? await db.report.findMany({ where: { id: { in: reportIds }, tenantId }, select: { id: true, siteId: true } })
    : [];
  const reportSite = new Map(reports.map((r) => [r.id, r.siteId]));

  const pileGrade = aggregateUsage(pileRows as Array<Record<string, string>>, 'pileGradeId', reportSite);
  for (const plan of planRows as Array<{ pileGradeId: string; _count: { _all: number } }>) {
    if (!pileGrade[plan.pileGradeId]) pileGrade[plan.pileGradeId] = { reportCount: 0, planCount: 0, siteCount: 0 };
    pileGrade[plan.pileGradeId].planCount = plan._count._all;
  }

  return {
    pileGrade,
    drillingType: aggregateUsage(drillRows as Array<Record<string, string>>, 'typeId', reportSite),
    downtimeReason: aggregateUsage(downtimeRows as Array<Record<string, string>>, 'reasonId', reportSite),
    siteTotals: {
      pileGrade: distinctSites(pileRows as Array<Record<string, string>>, reportSite),
      drillingType: distinctSites(drillRows as Array<Record<string, string>>, reportSite),
      downtimeReason: distinctSites(downtimeRows as Array<Record<string, string>>, reportSite),
    },
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
  // Время архивации хранит только марка сваи: по нему принимаются сваи,
  // отправленные с телефона после архивации (см. requirePileGrade).
  const data = type === 'pileGrade' ? { isActive, archivedAt: isActive ? null : new Date() } : { isActive };
  const updated = await model.update({ where: { id, tenantId }, data });
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

/**
 * Длина — источник погонных метров, а метры отчётов считаются живьём.
 *
 * Поэтому у используемой марки изменение длины пересчитывает цифры сданных
 * документов и печатных форм за прошлые периоды. Решение владельца от 12.09.2026:
 * менять разрешено, но только с явным подтверждением — оно обязано проверяться на
 * сервере, а не только в диалоге браузера. Убрать длину (null) или обнулить её у
 * используемой марки нельзя вовсе: это молча обнулило бы метраж отчётов.
 */
export async function setPileGradeLength(
  context: DictionaryMutationContext,
  id: string,
  lengthMm: number | null,
  confirmRecalculate = false
) {
  const { tenantId, actorId } = context;
  assertTenantId(tenantId);
  const item = await db.pileGrade.findFirst({ where: { id, tenantId } });
  if (!item) throw new ServiceError('Элемент не найден', 404);
  const usage = await getItemUsage(tenantId, 'pileGrade', id);
  const used = usage.reportCount > 0;
  if (used && (lengthMm === null || lengthMm === 0)) {
    throw new ServiceError('У используемой марки нельзя убрать длину — метраж отчётов обнулится', 422);
  }
  assertLengthMm(lengthMm);
  if (used && lengthMm !== item.lengthMm && !confirmRecalculate) {
    throw new ServiceError(`Марка используется в ${usage.reportCount} отчётах: изменение длины пересчитает метраж в них. Подтвердите изменение.`, 409);
  }
  const updated = await db.pileGrade.update({ where: { id, tenantId }, data: { lengthMm } });
  await recordAuditEvent({
    action: 'dictionary.length_updated', scope: 'dictionaries', actorId,
    targetId: id, tenantId, metadata: { type: 'pileGrade', before: item, after: updated },
  });
  return updated;
}

export async function setPileGradeSection(
  context: DictionaryMutationContext,
  id: string,
  sectionOrDiameter: string | null
) {
  const { tenantId, actorId } = context;
  assertTenantId(tenantId);
  const trimmed = sectionOrDiameter?.trim() || null;
  if (trimmed && trimmed.length > 100) throw new ServiceError('Сечение слишком длинное', 400);
  const item = await db.pileGrade.findFirst({ where: { id, tenantId } });
  if (!item) throw new ServiceError('Элемент не найден', 404);
  const updated = await db.pileGrade.update({ where: { id, tenantId }, data: { sectionOrDiameter: trimmed } });
  await recordAuditEvent({
    action: 'dictionary.section_updated', scope: 'dictionaries', actorId,
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
