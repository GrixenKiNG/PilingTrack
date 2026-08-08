import type { Prisma } from '@/generated/postgres-client/client';
import { db } from '@/lib/db';
import {
  DEFAULT_READINESS_RULES,
  bumpVersion,
  describeRuleSetChanges,
  sanitizeRuleSet,
  type ReadinessRuleSet,
} from '../domain/readiness-rules';

export interface ReadinessRulesState {
  published: ReadinessRuleSet;
  draft: ReadinessRuleSet | null;
  pendingChanges: number;
  /**
   * Лежит ли действующая версия в базе. Если нет, `published` — это значения
   * по умолчанию из кода: экран обязан показать их как непринятые, а вычислитель
   * готовности такие правила не признаёт и блокирует расчёт.
   */
  publishedInDb: boolean;
}

function toRuleSet(
  row: {
    version: string;
    status: string;
    criteria: Prisma.JsonValue;
    blockers: Prisma.JsonValue;
    updatedAt: Date;
    updatedBy: string | null;
    publishedAt: Date | null;
  },
  fallback = DEFAULT_READINESS_RULES,
): ReadinessRuleSet {
  return sanitizeRuleSet({
    version: row.version,
    status: row.status,
    criteria: row.criteria,
    blockers: row.blockers,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy ?? undefined,
    publishedAt: row.publishedAt?.toISOString() ?? null,
  }, fallback);
}

const diffCount = (draft: ReadinessRuleSet, published: ReadinessRuleSet): number =>
  describeRuleSetChanges(published, draft).length;

export async function getReadinessRules(tenantId: string): Promise<ReadinessRulesState> {
  if (!tenantId) throw new Error('getReadinessRules: tenantId is required');
  const rows = await db.readinessRuleSet.findMany({
    where: { tenantId, status: { in: ['PUBLISHED', 'DRAFT'] } },
    orderBy: { updatedAt: 'desc' },
  });
  const publishedRow = rows.find((row) => row.status === 'PUBLISHED');
  const published = publishedRow ? toRuleSet(publishedRow) : DEFAULT_READINESS_RULES;
  const draftRow = rows.find((row) => row.status === 'DRAFT');
  const draft = draftRow ? toRuleSet(draftRow, published) : null;
  return {
    published,
    draft,
    pendingChanges: draft ? diffCount(draft, published) : 0,
    publishedInDb: Boolean(publishedRow),
  };
}

export async function saveReadinessDraft(
  tenantId: string,
  patch: unknown,
  actor: { id: string; name: string; role: string },
): Promise<ReadinessRulesState> {
  if (!tenantId) throw new Error('saveReadinessDraft: tenantId is required');
  const state = await getReadinessRules(tenantId);
  const next = sanitizeRuleSet(patch, state.draft ?? state.published);
  const existing = await db.readinessRuleSet.findFirst({
    where: { tenantId, status: 'DRAFT' },
    select: { id: true },
  });

  await db.$transaction(async (tx) => {
    const data = {
      version: bumpVersion(state.published.version),
      criteria: next.criteria as unknown as Prisma.InputJsonValue,
      blockers: next.blockers as unknown as Prisma.InputJsonValue,
      updatedBy: actor.id,
    };
    const row = existing
      ? await tx.readinessRuleSet.update({ where: { id: existing.id }, data })
      : await tx.readinessRuleSet.create({
        data: { tenantId, status: 'DRAFT', ...data },
      });
    await tx.auditLog.create({
      data: {
        entity: 'ReadinessRuleSet',
        action: 'draft_saved',
        entityId: row.id,
        before: state.draft
          ? state.draft as unknown as Prisma.InputJsonValue
          : undefined,
        after: next as unknown as Prisma.InputJsonValue,
        userId: actor.id,
        userName: actor.name,
        userRole: actor.role,
        tenantId,
      },
    });
  });
  return getReadinessRules(tenantId);
}

async function publishBaseline(
  tenantId: string,
  baseline: ReadinessRuleSet,
  actor: { id: string; name: string; role: string },
): Promise<ReadinessRulesState> {
  await db.$transaction(async (tx) => {
    const published = await tx.readinessRuleSet.create({
      data: {
        tenantId,
        status: 'PUBLISHED',
        version: baseline.version,
        criteria: baseline.criteria as unknown as Prisma.InputJsonValue,
        blockers: baseline.blockers as unknown as Prisma.InputJsonValue,
        publishedAt: new Date(),
        updatedBy: actor.id,
      },
    });
    await tx.auditLog.create({
      data: {
        entity: 'ReadinessRuleSet',
        action: 'published',
        entityId: published.id,
        after: {
          version: published.version,
          criteria: published.criteria,
          blockers: published.blockers,
        },
        userId: actor.id,
        userName: actor.name,
        userRole: actor.role,
        tenantId,
      },
    });
  });
  return getReadinessRules(tenantId);
}

export async function publishReadinessRules(
  tenantId: string,
  actor: { id: string; name: string; role: string },
): Promise<ReadinessRulesState> {
  if (!tenantId) throw new Error('publishReadinessRules: tenantId is required');
  const state = await getReadinessRules(tenantId);
  const draftRow = await db.readinessRuleSet.findFirst({
    where: { tenantId, status: 'DRAFT' },
  });
  if (!draftRow) {
    // Публиковать нечего только если действующая версия уже лежит в базе.
    // У нового тенанта её нет: getReadinessRules отдаёт значения по умолчанию
    // из кода, экран рисует «Опубликована», а вычислитель готовности при этом
    // считает правила неопубликованными и блокирует расчёт. Первое нажатие
    // «Опубликовать» должно закрепить эти значения в базе, а не молча ничего
    // не сделать.
    const publishedRow = await db.readinessRuleSet.findFirst({
      where: { tenantId, status: 'PUBLISHED' },
      select: { id: true },
    });
    if (publishedRow) return state;
    return publishBaseline(tenantId, state.published, actor);
  }

  await db.$transaction(async (tx) => {
    await tx.readinessRuleSet.updateMany({
      where: { tenantId, status: 'PUBLISHED' },
      data: { status: 'ARCHIVED' },
    });
    const published = await tx.readinessRuleSet.update({
      where: { id: draftRow.id },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
        updatedBy: actor.id,
      },
    });
    await tx.auditLog.create({
      data: {
        entity: 'ReadinessRuleSet',
        action: 'published',
        entityId: published.id,
        before: state.published as unknown as Prisma.InputJsonValue,
        after: {
          version: published.version,
          criteria: published.criteria,
          blockers: published.blockers,
        },
        userId: actor.id,
        userName: actor.name,
        userRole: actor.role,
        tenantId,
      },
    });
  });
  return getReadinessRules(tenantId);
}
