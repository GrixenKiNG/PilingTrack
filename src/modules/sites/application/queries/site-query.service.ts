/**
 * Site Query Service — CQRS Read Side
 */

import { db } from '@/lib/db';
import { ServiceError } from '@/lib/service-error';
// eslint-disable-next-line no-restricted-imports -- legacy cross-layer import pending the parked services<->modules migration (CLAUDE.md); behavior-neutral
import { resolveAccessibleUserId } from '@/services/auth/resource-access-service';
// eslint-disable-next-line no-restricted-imports -- legacy cross-layer import pending the parked services<->modules migration (CLAUDE.md); behavior-neutral
import { assertCanAccessSite } from '@/services/auth/resource-access-service';
import type { CursorPaginationResult } from '@/lib/pagination-cursor';
import { resolveEquipmentOperationalStates } from '@/modules/equipment';

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
  // Бригады и закреплённые за ними установки — доказательная часть карточки
  // объекта: кто и на чём здесь работает. Только действующие: расформированная
  // бригада остаётся в базе историей отчётов, но на объекте её уже нет.
  crews: {
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      operator: { select: { id: true, name: true } },
      assistants: { select: { id: true, name: true } },
      equipment: { select: { id: true, name: true, model: true, isActive: true } },
    },
    orderBy: { name: 'asc' },
  },
} as const;

export async function getAccessibleSites(
  sessionUser: { id: string; role: string },
  tenantId: string,
  requestedUserId?: string | null,
  pagination?: CursorPaginationResult
) {
  if (!tenantId) throw new ServiceError('tenantId is required', 400);
  const take = pagination?.take ?? 50;
  const cursor = pagination?.cursor ?? undefined;

  // ADMIN and DISPATCHER can see all active sites
  if (sessionUser.role === 'ADMIN' || sessionUser.role === 'DISPATCHER') {
    return db.site.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, name: true, plannedPiles: true, plannedDrilling: true },
      orderBy: { name: 'asc' },
      cursor: cursor ? { id: cursor } : undefined,
      take: take + 1,
      skip: cursor ? 1 : 0,
    });
  }

  const targetUserId = resolveAccessibleUserId(sessionUser, requestedUserId, 'reports.read_cross_user');

  return db.site.findMany({
    where: { tenantId, isActive: true, users: { some: { userId: targetUserId } } },
    select: { id: true, name: true, plannedPiles: true, plannedDrilling: true },
    orderBy: { name: 'asc' },
    cursor: cursor ? { id: cursor } : undefined,
    take: take + 1,
    skip: cursor ? 1 : 0,
  });
}

export async function getSiteWithHierarchy(
  sessionUser: { id: string; role: string },
  tenantId: string,
  siteId: string
) {
  if (!tenantId) throw new ServiceError('tenantId is required', 400);
  await assertCanAccessSite(sessionUser, siteId, 'sites.read_all');

  const site = await db.site.findFirst({
    where: { id: siteId, tenantId },
    include: siteDetailInclude,
  });
  if (!site) return site;

  // Состояние машин добираем отдельным запросом: оно выводится из смен и
  // нарядов, а не хранится, и связью в `include` его не достать. Правило —
  // общее для всего продукта (`@/modules/equipment`), чтобы дашборд, парк и
  // карточка объекта не отвечали об одной машине по-разному.
  const equipmentIds = site.crews
    .map((crew) => crew.equipment?.id)
    .filter((id): id is string => Boolean(id));
  const states = await resolveEquipmentOperationalStates(tenantId, equipmentIds);

  return {
    ...site,
    crews: site.crews.map((crew) => ({
      ...crew,
      equipmentState: crew.equipment ? states[crew.equipment.id] ?? 'idle' : null,
    })),
  };
}

export async function listAllSitesForAdmin(tenantId: string, includeInactive = true) {
  if (!tenantId) throw new ServiceError('tenantId is required', 400);
  return db.site.findMany({
    where: { tenantId, ...(includeInactive ? {} : { isActive: true }) },
    select: {
      id: true,
      name: true,
      isActive: true,
      plannedPiles: true,
      plannedDrilling: true,
      completionDate: true,
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
