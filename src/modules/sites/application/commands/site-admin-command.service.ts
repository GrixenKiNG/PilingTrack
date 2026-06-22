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
  actorId?: string;
}) {
  if (!input.name?.trim()) {
    throw new ServiceError('Name required', 400);
  }

  const normalized = normalizeSitePlans(input);

  const site = await db.$transaction(async (tx) => {
    const created = await tx.site.create({
      data: {
        name: input.name.trim(),
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
    actorId: input.actorId || null,
    targetId: site.id,
    metadata: { name: site.name, plannedPiles: site.plannedPiles, plannedDrilling: site.plannedDrilling },
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
  actorId?: string;
}) {
  const existing = await db.site.findUnique({ where: { id: siteId } });
  if (!existing) {
    throw new ServiceError('Site not found', 404);
  }

  const normalized = normalizeSitePlans({
    pilePlans: input.pilePlans,
    drillingPlans: input.drillingPlans,
  });

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
        plannedPiles: input.plannedPiles !== undefined ? input.plannedPiles : normalized.plannedPiles,
        plannedDrilling: input.plannedDrilling !== undefined ? input.plannedDrilling : normalized.plannedDrilling,
        ...(completionDate && { completionDate }),
      },
    });

    // Delete old plans
    await tx.sitePilePlan.deleteMany({ where: { siteId } });
    await tx.siteDrillingPlan.deleteMany({ where: { siteId } });

    // Create new pile plans
    for (const plan of normalized.pilePlans) {
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
    for (const plan of normalized.drillingPlans) {
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
    actorId: input.actorId || null,
    targetId: siteId,
    metadata: {
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

export async function assignUserToSite(siteId: string, userId: string) {
  if (!siteId || !userId) {
    throw new ServiceError('userId and siteId required', 400);
  }

  return db.userSiteAssignment.upsert({
    where: { userId_siteId: { userId, siteId } },
    update: {},
    create: { userId, siteId },
  });
}

export async function unassignUserFromSite(siteId: string, userId: string) {
  if (!siteId || !userId) {
    throw new ServiceError('userId and siteId required', 400);
  }

  await db.userSiteAssignment.deleteMany({
    where: { userId, siteId },
  });

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
}) {
  if (!input.type || !input.name?.trim()) {
    throw new ServiceError('Type and name required', 400);
  }

  if (input.type === 'field') {
    return db.pileField.create({
      data: { name: input.name.trim(), siteId: input.siteId },
    });
  }

  if (input.type === 'cluster') {
    if (!input.parentId) {
      throw new ServiceError('parentId required', 400);
    }
    return db.cluster.create({
      data: { name: input.name.trim(), fieldId: input.parentId },
    });
  }

  if (input.type === 'picket') {
    if (!input.parentId) {
      throw new ServiceError('parentId required', 400);
    }
    return db.picket.create({
      data: { name: input.name.trim(), clusterId: input.parentId },
    });
  }

  throw new ServiceError('Invalid type', 400);
}

export async function deleteSiteHierarchyItem(type: string, itemId: string) {
  if (!type || !itemId) {
    throw new ServiceError('Type and itemId required', 400);
  }

  if (type === 'field') {
    await db.pileField.delete({ where: { id: itemId } });
    return { success: true };
  }

  if (type === 'cluster') {
    await db.cluster.delete({ where: { id: itemId } });
    return { success: true };
  }

  if (type === 'picket') {
    await db.picket.delete({ where: { id: itemId } });
    return { success: true };
  }

  throw new ServiceError('Invalid type', 400);
}
