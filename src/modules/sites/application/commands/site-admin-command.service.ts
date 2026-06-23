/**
 * Site Admin Command Service — admin-specific write operations
 * (plan management, hierarchy, user assignments)
 */

import { db } from '@/lib/db';
import { ServiceError } from '@/lib/service-error';
// eslint-disable-next-line no-restricted-imports -- legacy cross-layer import pending the parked services<->modules migration (CLAUDE.md); behavior-neutral
import { recordAuditEvent } from '@/services/audit/audit-service';

// ────────────────────────────────────────────
// Plan normalization
// ────────────────────────────────────────────

interface IncomingPilePlan {
  pileGradeId?: string;
  count?: number;
  metersPerUnit?: number;
}

interface IncomingDrillingPlan {
  diameter?: number;
  count?: number;
  metersPerUnit?: number;
}

type ValidPilePlan = { pileGradeId: string; count: number; metersPerUnit?: number };
type ValidDrillingPlan = { diameter?: number; count: number; metersPerUnit?: number };

export interface SiteCommandContext { tenantId: string; actorId: string }

async function requireTenantSite(siteId: string, tenantId: string) {
  if (!tenantId) throw new ServiceError('tenantId is required', 400);
  const site = await db.site.findFirst({ where: { id: siteId, tenantId } });
  if (!site) throw new ServiceError('Site not found', 404);
  return site;
}

async function validatePileGrades(tenantId: string, plans: ValidPilePlan[]) {
  const ids = [...new Set(plans.map((plan) => plan.pileGradeId))];
  if (!ids.length) return;
  const count = await db.pileGrade.count({ where: { id: { in: ids }, tenantId } });
  if (count !== ids.length) throw new ServiceError('Pile grade not found', 404);
}

export function normalizeSitePlans(input: {
  pilePlans?: IncomingPilePlan[];
  drillingPlans?: IncomingDrillingPlan[];
}) {
  const pilePlans: ValidPilePlan[] =
    input.pilePlans && Array.isArray(input.pilePlans)
      ? input.pilePlans.filter(
          (plan: IncomingPilePlan): plan is ValidPilePlan =>
            Boolean(plan.pileGradeId) && typeof plan.count === 'number' && plan.count > 0
        )
      : [];

  const drillingPlans: ValidDrillingPlan[] =
    input.drillingPlans && Array.isArray(input.drillingPlans)
      ? input.drillingPlans.filter(
          (plan: IncomingDrillingPlan): plan is ValidDrillingPlan =>
            typeof plan.count === 'number' && plan.count > 0
        )
      : [];

  const plannedPiles = pilePlans.reduce((sum, plan) => sum + (Number(plan.count) || 0), 0);
  const plannedDrilling = drillingPlans.reduce(
    (sum, plan) => sum + (Number(plan.count) || 0) * (Number(plan.metersPerUnit) || 0),
    0
  );

  return { pilePlans, drillingPlans, plannedPiles, plannedDrilling };
}

// ────────────────────────────────────────────
// Create site with plans (transactional)
// ────────────────────────────────────────────

export async function createSiteWithPlans(input: {
  name: string;
  pilePlans?: IncomingPilePlan[];
  drillingPlans?: IncomingDrillingPlan[];
}, ctx: SiteCommandContext) {
  if (!ctx.tenantId) throw new ServiceError('tenantId is required', 400);
  if (!input.name?.trim()) {
    throw new ServiceError('Name required', 400);
  }

  const normalized = normalizeSitePlans(input);
  await validatePileGrades(ctx.tenantId, normalized.pilePlans);

  const site = await db.$transaction(async (tx) => {
    const created = await tx.site.create({
      data: {
        name: input.name.trim(),
        tenantId: ctx.tenantId,
        plannedPiles: normalized.plannedPiles,
        plannedDrilling: normalized.plannedDrilling,
      },
    });

    for (const plan of normalized.pilePlans) {
      await tx.sitePilePlan.create({
        data: {
          siteId: created.id,
          pileGradeId: plan.pileGradeId,
          count: Number(plan.count) || 0,
          metersPerUnit: Number(plan.metersPerUnit) || 0,
        },
      });
    }

    for (const plan of normalized.drillingPlans) {
      await tx.siteDrillingPlan.create({
        data: {
          siteId: created.id,
          diameter: Number(plan.diameter) || 0,
          count: Number(plan.count) || 0,
          metersPerUnit: Number(plan.metersPerUnit) || 0,
        },
      });
    }

    return created;
  });

  await recordAuditEvent({
    action: 'site.created',
    scope: 'sites',
    actorId: ctx.actorId,
    targetId: site.id,
    metadata: { tenantId: ctx.tenantId, name: site.name, plannedPiles: site.plannedPiles, plannedDrilling: site.plannedDrilling },
  });

  return site;
}

// ────────────────────────────────────────────
// Update site with plans (transactional)
// ────────────────────────────────────────────

export async function updateSiteWithPlans(siteId: string, input: {
  name?: string;
  plannedPiles?: number;
  plannedDrilling?: number;
  completionDate?: Date | string;
  pilePlans?: IncomingPilePlan[];
  drillingPlans?: IncomingDrillingPlan[];
}, ctx: SiteCommandContext) {
  const existing = await requireTenantSite(siteId, ctx.tenantId);

  const normalized = normalizeSitePlans({
    pilePlans: input.pilePlans,
    drillingPlans: input.drillingPlans,
  });
  const hasPilePlans = input.pilePlans !== undefined;
  const hasDrillingPlans = input.drillingPlans !== undefined;
  if (hasPilePlans) await validatePileGrades(ctx.tenantId, normalized.pilePlans);

  const completionDate = input.completionDate
    ? input.completionDate instanceof Date
      ? input.completionDate
      : new Date(input.completionDate)
    : undefined;

  const updated = await db.$transaction(async (tx) => {
    // Update site fields
    await tx.site.update({
      where: { id: siteId },
      data: {
        name: input.name !== undefined ? input.name.trim() : undefined,
        plannedPiles: hasPilePlans ? normalized.plannedPiles : input.plannedPiles,
        plannedDrilling: hasDrillingPlans ? normalized.plannedDrilling : input.plannedDrilling,
        ...(completionDate && { completionDate }),
      },
    });

    // Delete old plans
    if (hasPilePlans) await tx.sitePilePlan.deleteMany({ where: { siteId } });
    if (hasDrillingPlans) await tx.siteDrillingPlan.deleteMany({ where: { siteId } });

    // Create new pile plans
    for (const plan of hasPilePlans ? normalized.pilePlans : []) {
      await tx.sitePilePlan.create({
        data: {
          siteId,
          pileGradeId: plan.pileGradeId,
          count: Number(plan.count) || 0,
          metersPerUnit: Number(plan.metersPerUnit) || 0,
        },
      });
    }

    // Create new drilling plans
    for (const plan of hasDrillingPlans ? normalized.drillingPlans : []) {
      await tx.siteDrillingPlan.create({
        data: {
          siteId,
          diameter: Number(plan.diameter) || 0,
          count: Number(plan.count) || 0,
          metersPerUnit: Number(plan.metersPerUnit) || 0,
        },
      });
    }

    return tx.site.findUnique({
      where: { id: siteId },
      include: {
        pilePlans: { include: { pileGrade: true } },
        drillingPlans: true,
      },
    });
  });

  await recordAuditEvent({
    action: 'site.updated',
    scope: 'sites',
    actorId: ctx.actorId,
    targetId: siteId,
    metadata: {
      tenantId: ctx.tenantId,
      before: { name: existing.name, plannedPiles: existing.plannedPiles, plannedDrilling: existing.plannedDrilling },
      after: updated
        ? { name: updated.name, plannedPiles: updated.plannedPiles, plannedDrilling: updated.plannedDrilling }
        : null,
    },
  });

  return updated;
}

// ────────────────────────────────────────────
// User–Site assignments
// ────────────────────────────────────────────

export async function assignUserToSite(siteId: string, userId: string, ctx: SiteCommandContext) {
  if (!siteId || !userId) {
    throw new ServiceError('userId and siteId required', 400);
  }

  await requireTenantSite(siteId, ctx.tenantId);
  const user = await db.user.findFirst({ where: { id: userId, tenantId: ctx.tenantId }, select: { id: true } });
  if (!user) throw new ServiceError('User not found', 404);
  const result = await db.userSiteAssignment.upsert({
    where: { userId_siteId: { userId, siteId } },
    update: {},
    create: { userId, siteId },
  });
  await recordAuditEvent({ action: 'site.user_assigned', scope: 'sites', actorId: ctx.actorId,
    targetId: siteId, metadata: { tenantId: ctx.tenantId, userId } });
  return result;
}

export async function unassignUserFromSite(siteId: string, userId: string, ctx: SiteCommandContext) {
  if (!siteId || !userId) {
    throw new ServiceError('userId and siteId required', 400);
  }

  await requireTenantSite(siteId, ctx.tenantId);
  await db.userSiteAssignment.deleteMany({
    where: { userId, siteId },
  });

  await recordAuditEvent({ action: 'site.user_unassigned', scope: 'sites', actorId: ctx.actorId,
    targetId: siteId, metadata: { tenantId: ctx.tenantId, userId } });
  return { success: true };
}

// ────────────────────────────────────────────
// Site hierarchy (field / cluster / picket)
// ────────────────────────────────────────────

export async function createSiteHierarchyItem(input: {
  siteId: string;
  type: string;
  name: string;
  parentId?: string;
}, ctx: SiteCommandContext) {
  if (!input.type || !input.name?.trim()) {
    throw new ServiceError('Type and name required', 400);
  }
  if (!['field', 'cluster', 'picket'].includes(input.type)) throw new ServiceError('Invalid type', 400);
  if (input.type !== 'field' && !input.parentId) throw new ServiceError('parentId required', 400);

  await requireTenantSite(input.siteId, ctx.tenantId);
  if (input.type === 'field') {
    return db.pileField.create({
      data: { name: input.name.trim(), siteId: input.siteId },
    });
  }

  if (input.type === 'cluster') {
    const parentId = input.parentId!;
    const parent = await db.pileField.findFirst({ where: { id: parentId, siteId: input.siteId }, select: { id: true } });
    if (!parent) throw new ServiceError('Parent not found', 404);
    return db.cluster.create({
      data: { name: input.name.trim(), fieldId: parentId },
    });
  }

  if (input.type === 'picket') {
    const parentId = input.parentId!;
    const parent = await db.cluster.findFirst({ where: { id: parentId, field: { siteId: input.siteId } }, select: { id: true } });
    if (!parent) throw new ServiceError('Parent not found', 404);
    return db.picket.create({
      data: { name: input.name.trim(), clusterId: parentId },
    });
  }

  throw new ServiceError('Invalid type', 400);
}

export async function deleteSiteHierarchyItem(siteId: string, type: string, itemId: string, ctx: SiteCommandContext) {
  if (!type || !itemId || !siteId) {
    throw new ServiceError('Type and itemId required', 400);
  }
  if (!['field', 'cluster', 'picket'].includes(type)) throw new ServiceError('Invalid type', 400);

  await requireTenantSite(siteId, ctx.tenantId);
  if (type === 'field') {
    const item = await db.pileField.findFirst({ where: { id: itemId, siteId }, select: { id: true } });
    if (!item) throw new ServiceError('Hierarchy item not found', 404);
    await db.pileField.delete({ where: { id: itemId } });
    return { success: true };
  }

  if (type === 'cluster') {
    const item = await db.cluster.findFirst({ where: { id: itemId, field: { siteId } }, select: { id: true } });
    if (!item) throw new ServiceError('Hierarchy item not found', 404);
    await db.cluster.delete({ where: { id: itemId } });
    return { success: true };
  }

  if (type === 'picket') {
    const item = await db.picket.findFirst({ where: { id: itemId, cluster: { field: { siteId } } }, select: { id: true } });
    if (!item) throw new ServiceError('Hierarchy item not found', 404);
    await db.picket.delete({ where: { id: itemId } });
    return { success: true };
  }

  throw new ServiceError('Invalid type', 400);
}
