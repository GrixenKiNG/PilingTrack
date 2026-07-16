/**
 * Crew Query Service
 */

import { db } from '@/lib/db';
import { ServiceError } from '@/lib/service-error';
// eslint-disable-next-line no-restricted-imports -- legacy cross-layer import pending the parked services<->modules migration (CLAUDE.md); behavior-neutral
import { isPrivilegedRole } from '@/services/auth/authorization-service';
import type { CursorPaginationResult } from '@/lib/pagination-cursor';

export async function getAccessibleCrews(tenantId: string, siteId?: string, pagination?: CursorPaginationResult) {
  // Fail-closed (IDOR guard): Crew has no tenantId column; its tenant is the
  // owning site's. Scope every list to the caller's tenant via site.tenantId.
  if (!tenantId) throw new ServiceError('tenantId is required', 400);
  const take = pagination?.take ?? 50;
  const cursor = pagination?.cursor ?? undefined;

  return db.crew.findMany({
    where: { site: { tenantId }, ...(siteId ? { siteId } : {}) },
    include: {
      operator: { select: { id: true, name: true, role: true } },
      equipment: { select: { id: true, name: true } },
      site: { select: { id: true, name: true } },
      assistants: { select: { id: true, name: true, userId: true } },
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
      assistants: { select: { id: true, name: true, userId: true } },
    },
  });

  if (!crew) {
    throw new ServiceError('Crew not found', 404);
  }

  return crew;
}

/**
 * Get crew for operator (with role-based access control)
 */
export async function getCrewForOperator(
  sessionUser: { id: string; role: string },
  requestedOperatorId?: string | null
) {
  const lookupUserId = isPrivilegedRole(sessionUser.role)
    ? requestedOperatorId || sessionUser.id
    : sessionUser.id;

  if (!lookupUserId) {
    throw new ServiceError('operatorId required', 400);
  }

  // A user reaches "their" crew either as the operator or as a linked
  // assistant (ASSISTANT users have no operator row), so match both.
  const crew = await db.crew.findFirst({
    where: {
      OR: [
        { operatorId: lookupUserId },
        { assistants: { some: { userId: lookupUserId } } },
      ],
    },
    include: {
      operator: { select: { name: true } },
      equipment: { select: { name: true } },
      site: { select: { name: true, tenantId: true } },
      assistants: { select: { id: true, crewId: true, name: true, userId: true }, orderBy: { createdAt: 'asc' } },
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
