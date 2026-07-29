import type { Prisma } from '@/generated/postgres-client/client';
import { db } from '@/lib/db';
import {
  DEFAULT_READINESS_RULES,
  bumpVersion,
  sanitizeRuleSet,
  type ReadinessRuleSet,
} from '../domain/readiness-rules';

export interface ReadinessRulesState {
  published: ReadinessRuleSet;
  draft: ReadinessRuleSet | null;
  pendingChanges: number;
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

function diffCount(draft: ReadinessRuleSet, published: ReadinessRuleSet): number {
  let changes = 0;
  draft.criteria.forEach((criterion) => {
    const before = published.criteria.find((item) => item.key === criterion.key);
    if (!before || before.weight !== criterion.weight || before.locked !== criterion.locked) {
      changes += 1;
    }
  });
  draft.blockers.forEach((blocker) => {
    const before = published.blockers.find((item) => item.condition === blocker.condition);
    if (!before || before.action !== blocker.action || before.isActive !== blocker.isActive) {
      changes += 1;
    }
  });
  return changes;
}

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

export async function publishReadinessRules(
  tenantId: string,
  actor: { id: string; name: string; role: string },
): Promise<ReadinessRulesState> {
  if (!tenantId) throw new Error('publishReadinessRules: tenantId is required');
  const state = await getReadinessRules(tenantId);
  const draftRow = await db.readinessRuleSet.findFirst({
    where: { tenantId, status: 'DRAFT' },
  });
  if (!draftRow) return state;

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
