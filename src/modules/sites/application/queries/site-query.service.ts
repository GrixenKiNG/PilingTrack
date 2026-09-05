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

/**
 * Состояние установки на объекте: работает, стоит или в ремонте.
 *
 * ПОЧЕМУ НЕ ПОЛЕ В ТАБЛИЦЕ. Колонки `Equipment.status` в продукте нет намеренно
 * — состояние выводится из фактов: идёт ли по машине смена и висит ли на ней
 * открытая поломка. Заведи её полем, и первое же расхождение с фактами дало бы
 * «в работе» у машины, которую вчера увезли в ремонт.
 *
 * ПОРЯДОК ВАЖЕН. Ремонт перекрывает смену: если на машине открыта неисправность,
 * она в ремонте, даже когда смену на ней формально не закрыли. Тем же правилом
 * живут карточки парка (`fleet-monitoring`), и два разных ответа об одной
 * машине на двух экранах хуже, чем один огрублённый.
 */
export type SiteEquipmentState = 'WORKING' | 'REPAIR' | 'IDLE';

async function resolveEquipmentStates(
  tenantId: string,
  equipmentIds: string[],
): Promise<Record<string, SiteEquipmentState>> {
  if (equipmentIds.length === 0) return {};

  const [running, repairs] = await Promise.all([
    db.shift.findMany({
      where: {
        tenantId,
        equipmentId: { in: equipmentIds },
        state: { in: ['STARTED', 'HANDOVER_PENDING'] },
      },
      select: { equipmentId: true },
    }),
    db.maintenanceRecord.findMany({
      where: {
        equipmentId: { in: equipmentIds },
        type: { in: ['REPAIR', 'FAULT'] },
        status: { notIn: ['DONE', 'CANCELLED'] },
      },
      select: { equipmentId: true },
    }),
  ]);

  const states: Record<string, SiteEquipmentState> = {};
  for (const id of equipmentIds) states[id] = 'IDLE';
  for (const row of running) states[row.equipmentId] = 'WORKING';
  for (const row of repairs) states[row.equipmentId] = 'REPAIR';
  return states;
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
  // нарядов, а не хранится, и связью в `include` его не достать.
  const equipmentIds = site.crews
    .map((crew) => crew.equipment?.id)
    .filter((id): id is string => Boolean(id));
  const states = await resolveEquipmentStates(tenantId, equipmentIds);

  return {
    ...site,
    crews: site.crews.map((crew) => ({
      ...crew,
      equipmentState: crew.equipment ? states[crew.equipment.id] ?? 'IDLE' : null,
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
