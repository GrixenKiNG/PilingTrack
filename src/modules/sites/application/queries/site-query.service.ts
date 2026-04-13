/**
 * Site Query Service — CQRS Read Side
 */

import { db } from '@/lib/db';
import { resolveAccessibleUserId } from '@/services/auth/resource-access-service';
import { assertCanAccessSite } from '@/services/auth/resource-access-service';
import type { CursorPaginationResult } from '@/lib/pagination-cursor';

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

export async function getAccessibleSites(
  sessionUser: { id: string; role: string },
  requestedUserId?: string | null,
  pagination?: CursorPaginationResult
) {
  const take = pagination?.take ?? 50;
  const cursor = pagination?.cursor ?? undefined;

  // ADMIN and DISPATCHER can see all active sites
  if (sessionUser.role === 'ADMIN' || sessionUser.role === 'DISPATCHER') {
    return db.site.findMany({
      where: { isActive: true },
      select: { id: true, name: true, plannedPiles: true, plannedDrilling: true },
      orderBy: { name: 'asc' },
      cursor: cursor ? { id: cursor } : undefined,
      take: take + 1,
      skip: cursor ? 1 : 0,
    });
  }

  const targetUserId = resolveAccessibleUserId(sessionUser, requestedUserId, 'reports.read_cross_user');

  return db.site.findMany({
    where: { isActive: true, users: { some: { userId: targetUserId } } },
    select: { id: true, name: true, plannedPiles: true, plannedDrilling: true },
    orderBy: { name: 'asc' },
    cursor: cursor ? { id: cursor } : undefined,
    take: take + 1,
    skip: cursor ? 1 : 0,
  });
}

export async function getSiteWithHierarchy(
  sessionUser: { id: string; role: string },
  siteId: string
) {
  await assertCanAccessSite(sessionUser, siteId, 'sites.read_all');

  return db.site.findUnique({
    where: { id: siteId },
    include: siteDetailInclude,
  });
}

export async function listAllSites() {
  return db.site.findMany({
    where: { isActive: true },
    select: { id: true, name: true, plannedPiles: true, plannedDrilling: true, status: true },
    orderBy: { name: 'asc' },
  });
}

export async function listAllSitesForAdmin() {
  return db.site.findMany({
    select: {
      id: true,
      name: true,
      isActive: true,
      plannedPiles: true,
      plannedDrilling: true,
      _count: {
        select: {
          pilePlans: true,
          drillingPlans: true,
        },
      },
    },
    orderBy: { name: 'asc' },
  });
}
