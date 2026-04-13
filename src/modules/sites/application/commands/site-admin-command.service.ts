/**
 * Site Admin Command Service — admin-specific write operations
 * (plan management, hierarchy, user assignments)
 */

import { db } from '@/lib/db';
import { ServiceError } from '@/services/service-error';

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
}) {
  if (!input.name?.trim()) {
    throw new ServiceError('Name required', 400);
  }

  const normalized = normalizeSitePlans(input);

  return db.$transaction(async (tx) => {
    const site = await tx.site.create({
      data: {
        name: input.name.trim(),
        plannedPiles: normalized.plannedPiles,
        plannedDrilling: normalized.plannedDrilling,
      },
    });

    for (const plan of normalized.pilePlans) {
      await tx.sitePilePlan.create({
        data: {
          siteId: site.id,
          pileGradeId: plan.pileGradeId,
          count: Number(plan.count) || 0,
          metersPerUnit: Number(plan.metersPerUnit) || 0,
        },
      });
    }

    for (const plan of normalized.drillingPlans) {
      await tx.siteDrillingPlan.create({
        data: {
          siteId: site.id,
          diameter: Number(plan.diameter) || 0,
          count: Number(plan.count) || 0,
          metersPerUnit: Number(plan.metersPerUnit) || 0,
        },
      });
    }

    return site;
  });
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
