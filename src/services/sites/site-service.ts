import { db } from '@/lib/db';
import { ServiceError } from '@/services/service-error';
import { assertCanAccessSite, resolveAccessibleUserId } from '@/services/auth/resource-access-service';

const siteDetailInclude = {
  fields: {
    include: {
      clusters: { include: { pickets: { orderBy: { name: 'asc' } } } },
    },
    orderBy: { name: 'asc' },
  },
  users: {
    include: {
      user: { select: { id: true, email: true, name: true, role: true, isActive: true } },
    },
  },
  pilePlans: {
    include: {
      pileGrade: { select: { id: true, name: true, isActive: true } },
    },
    orderBy: { createdAt: 'asc' },
  },
  drillingPlans: {
    orderBy: { createdAt: 'asc' },
  },
} as const;

export function resolveTargetUserId(
  sessionUser: { id: string; role: string },
  requestedUserId?: string | null
) {
  return resolveAccessibleUserId(sessionUser, requestedUserId, 'reports.read_cross_user');
}

export async function getAccessibleSitesForUser(
  sessionUser: { id: string; role: string },
  requestedUserId?: string | null
) {
  const targetUserId = resolveTargetUserId(sessionUser, requestedUserId);

  return db.site.findMany({
    where: {
      isActive: true,
      users: { some: { userId: targetUserId } },
    },
    select: { id: true, name: true, plannedPiles: true, plannedDrilling: true },
    orderBy: { name: 'asc' },
  });
}

export async function getAccessibleSiteById(
  sessionUser: { id: string; role: string },
  siteId: string
) {
  await assertCanAccessSite(sessionUser, siteId, 'sites.read_all');

  const site = await db.site.findUnique({
    where: { id: siteId },
    include: siteDetailInclude,
  });

  if (!site) {
    throw new ServiceError('Site not found', 404);
  }

  return site;
}
