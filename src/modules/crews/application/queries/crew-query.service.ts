/**
 * Crew Query Service
 */

import { db } from '@/lib/db';
import { ServiceError } from '@/services/service-error';
import { isPrivilegedRole } from '@/services/auth/authorization-service';
import type { CursorPaginationResult } from '@/lib/pagination-cursor';

export async function getAccessibleCrews(siteId?: string, pagination?: CursorPaginationResult) {
  const take = pagination?.take ?? 50;
  const cursor = pagination?.cursor ?? undefined;

  return db.crew.findMany({
    where: siteId ? { siteId } : {},
    include: {
      operator: { select: { id: true, name: true, role: true } },
      equipment: { select: { id: true, name: true } },
      site: { select: { id: true, name: true } },
      assistants: { select: { id: true, name: true } },
    },
    orderBy: { name: 'asc' },
    cursor: cursor ? { id: cursor } : undefined,
    take: take + 1,
    skip: cursor ? 1 : 0,
  });
}

export async function getCrewById(crewId: string) {
  const crew = await db.crew.findUnique({
    where: { id: crewId },
    include: {
      operator: { select: { id: true, name: true, email: true, role: true } },
      equipment: { select: { id: true, name: true, model: true } },
      site: { select: { id: true, name: true, tenantId: true } },
      assistants: { select: { id: true, name: true } },
    },
  });

  if (!crew) {
    throw new ServiceError('Crew not found', 404);
  }

  return crew;
}

export async function listAllCrews() {
  return db.crew.findMany({
    select: { id: true, name: true, operatorId: true, siteId: true, equipmentId: true },
    orderBy: { name: 'asc' },
  });
}

/**
 * List crew summaries for admin views
 */
export async function listCrewSummaries() {
  const crews = await db.crew.findMany({
    include: {
      operator: { select: { name: true } },
      equipment: { select: { name: true } },
      site: { select: { name: true, tenantId: true } },
      assistants: { select: { id: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return crews.map((crew) => ({
    id: crew.id,
    name: crew.name,
    operatorId: crew.operatorId,
    operatorName: crew.operator.name,
    assistantsCount: crew.assistants.length,
    equipmentId: crew.equipmentId,
    equipmentName: crew.equipment.name,
    siteId: crew.siteId,
    siteName: crew.site.name,
    tenantId: crew.site?.tenantId ?? null,
    isActive: crew.isActive,
    createdAt: crew.createdAt,
    updatedAt: crew.updatedAt,
  }));
}

/**
 * Get crew for operator (with role-based access control)
 */
export async function getCrewForOperator(
  sessionUser: { id: string; role: string },
  requestedOperatorId?: string | null
) {
  const operatorId = isPrivilegedRole(sessionUser.role)
    ? requestedOperatorId || sessionUser.id
    : sessionUser.id;

  if (!operatorId) {
    throw new ServiceError('operatorId required', 400);
  }

  const crew = await db.crew.findUnique({
    where: { operatorId },
    include: {
      operator: { select: { name: true } },
      equipment: { select: { name: true } },
      site: { select: { name: true, tenantId: true } },
      assistants: { select: { id: true, crewId: true, name: true }, orderBy: { createdAt: 'asc' } },
    },
  });

  if (!crew) {
    return null;
  }

  return {
    id: crew.id,
    name: crew.name,
    operatorId: crew.operatorId,
    operatorName: crew.operator.name,
    assistantsCount: crew.assistants.length,
    equipmentId: crew.equipmentId,
    equipmentName: crew.equipment.name,
    siteId: crew.siteId,
    siteName: crew.site.name,
    tenantId: crew.site?.tenantId ?? null,
    assistants: crew.assistants,
    isActive: crew.isActive,
    createdAt: crew.createdAt,
    updatedAt: crew.updatedAt,
  };
}
