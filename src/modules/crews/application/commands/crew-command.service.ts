/**
 * Crew Command Service
 */

import { db } from '@/lib/db';
import { ServiceError } from '@/lib/service-error';
// eslint-disable-next-line no-restricted-imports -- legacy cross-layer import pending the parked services<->modules migration (CLAUDE.md); behavior-neutral
import { recordAuditEvent } from '@/services/audit/audit-service';
import { CrewAggregate } from '../../domain';
import { getCrewRepository } from '../../infrastructure';
import { CreateCrewCommand, UpdateCrewCommand, DeleteCrewCommand } from './crew.command';
import { logger } from '@/lib/logger';

// Fields tracked in the crew assignment history (scope 'crews').
function crewAuditSnapshot(
  state: { name: string; operatorId: string; equipmentId: string; siteId: string; isActive: boolean },
  assistantNames?: string[],
) {
  return {
    name: state.name,
    operatorId: state.operatorId,
    equipmentId: state.equipmentId,
    siteId: state.siteId,
    isActive: state.isActive,
    ...(assistantNames !== undefined ? { assistants: assistantNames } : {}),
  };
}

// One installation = one active crew. Without a shift model (day/night crews
// on the same rig), assigning a rig already on another active crew is a data
// integrity error. Only checked when the rig is newly assigned, so re-saving an
// existing crew never trips on its own assignment. `excludeCrewId` skips self.
async function assertEquipmentNotDoubleBooked(equipmentId: string, excludeCrewId?: string) {
  const conflict = await db.crew.findFirst({
    where: { equipmentId, isActive: true, ...(excludeCrewId ? { id: { not: excludeCrewId } } : {}) },
    select: { id: true, name: true },
  });
  if (conflict) {
    throw new ServiceError(`Установка уже закреплена за активной бригадой «${conflict.name}»`, 409);
  }
}

// Tenant integrity: a crew may only be assembled from parts of one tenant.
// Closes the cross-tenant composition vector (operator/equipment/site with
// mismatched tenants). No-op under a single tenant. The site is the tenant
// anchor (Crew has no tenantId column — its tenant IS the site's).
function assertSameTenant(
  parts: { operatorTenantId?: string | null; equipmentTenantId?: string | null; siteTenantId?: string | null },
) {
  const { operatorTenantId, equipmentTenantId, siteTenantId } = parts;
  if (equipmentTenantId !== undefined && equipmentTenantId !== siteTenantId) {
    throw new ServiceError('Установка принадлежит другому арендатору', 400);
  }
  if (operatorTenantId !== undefined && operatorTenantId !== siteTenantId) {
    throw new ServiceError('Оператор принадлежит другому арендатору', 400);
  }
}

// Resolve the assistant roster to persist. Preferred path: ASSISTANT user ids
// — each is validated (exists, ASSISTANT role, same tenant as the crew) and the
// display name is snapshotted from the user. Falls back to legacy free-text
// names (no user link) when only assistantNames is supplied.
async function buildAssistantRows(
  command: { assistantUserIds?: string[]; assistantNames?: string[] },
  siteTenantId: string | null | undefined,
): Promise<Array<{ userId: string | null; name: string }>> {
  if (command.assistantUserIds && command.assistantUserIds.length > 0) {
    const ids = [...new Set(command.assistantUserIds)];
    const users = await db.user.findMany({
      where: { id: { in: ids }, role: 'ASSISTANT' },
      select: { id: true, name: true, tenantId: true },
    });
    if (users.length !== ids.length) {
      throw new ServiceError('Некоторые помощники не найдены или не являются пользователями с ролью ASSISTANT', 400);
    }
    for (const u of users) {
      if (u.tenantId !== siteTenantId) {
        throw new ServiceError('Помощник принадлежит другому арендатору', 400);
      }
    }
    return users.map((u) => ({ userId: u.id, name: u.name }));
  }
  return (command.assistantNames ?? [])
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
    .map((name) => ({ userId: null, name }));
}

export async function createCrew(command: CreateCrewCommand) {
  // Validate required fields before creating aggregate
  if (!command.operatorId || !command.equipmentId || !command.siteId) {
    throw new ServiceError('operatorId, equipmentId, and siteId are required', 400);
  }

  const name = (command.name || 'Unnamed Crew').trim();
  if (!name) {
    throw new ServiceError('Crew name cannot be empty', 400);
  }

  // Verify dependencies exist
  const [operator, equipment, site] = await Promise.all([
    db.user.findUnique({ where: { id: command.operatorId } }),
    db.equipment.findUnique({ where: { id: command.equipmentId } }),
    db.site.findUnique({ where: { id: command.siteId } }),
  ]);

  if (!operator) throw new ServiceError('Operator not found', 404);
  if (operator.role !== 'OPERATOR') throw new ServiceError('User must have OPERATOR role', 400);

  const existingOperatorCrew = await db.crew.findUnique({ where: { operatorId: command.operatorId } });
  if (existingOperatorCrew) {
    throw new ServiceError('Operator already has a crew', 409);
  }

  if (!equipment) throw new ServiceError('Equipment not found', 404);
  if (!site) throw new ServiceError('Site not found', 404);

  // Tenant integrity + one-rig-one-crew, before we create anything.
  assertSameTenant({
    operatorTenantId: operator.tenantId,
    equipmentTenantId: equipment.tenantId,
    siteTenantId: site.tenantId,
  });
  await assertEquipmentNotDoubleBooked(command.equipmentId);

  const aggregate = CrewAggregate.create({
    name,
    operatorId: command.operatorId,
    equipmentId: command.equipmentId,
    siteId: command.siteId,
  }, command.userId);

  const assistantRows = await buildAssistantRows(command, site.tenantId);

  try {
    // Crew + outbox + assistants persist atomically (one transaction).
    await getCrewRepository().save(aggregate, {
      onBeforeCommit: async (tx) => {
        if (assistantRows.length > 0) {
          await tx.crewAssistant.createMany({
            data: assistantRows.map((row) => ({ crewId: aggregate.getState().id, ...row })),
          });
        }
      },
    });
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (message.includes('UNIQUE') || message.includes('unique')) {
      throw new ServiceError('Crew with this operator already exists', 409);
    }
    if (message.includes('FOREIGN KEY')) {
      throw new ServiceError('Invalid crew dependencies', 400);
    }
    logger.error('CrewCommand: failed to save crew', error);
    throw new ServiceError('Failed to create crew', 500);
  }

  const created = await db.crew.findUnique({
    where: { id: aggregate.getState().id },
    include: { operator: true, equipment: true, site: true, assistants: true },
  });

  await recordAuditEvent({
    action: 'crew.created',
    scope: 'crews',
    actorId: command.userId || null,
    targetId: aggregate.getState().id,
    metadata: crewAuditSnapshot(aggregate.getState(), assistantRows.map((r) => r.name)),
  });

  return created;
}

export async function updateCrew(command: UpdateCrewCommand) {
  const repo = getCrewRepository();
  const aggregate = await repo.findById(command.crewId);
  if (!aggregate) {
    throw new ServiceError('Crew not found', 404);
  }

  const beforeAssistants = (
    await db.crewAssistant.findMany({ where: { crewId: command.crewId }, select: { name: true } })
  ).map((a) => a.name);
  const before = crewAuditSnapshot(aggregate.getState(), beforeAssistants);

  // Validate dependencies if operator/equipment/site are being changed
  if (command.operatorId || command.equipmentId || command.siteId) {
    const [operator, equipment, site] = await Promise.all([
      command.operatorId ? db.user.findUnique({ where: { id: command.operatorId } }) : null,
      command.equipmentId ? db.equipment.findUnique({ where: { id: command.equipmentId } }) : null,
      command.siteId ? db.site.findUnique({ where: { id: command.siteId } }) : null,
    ]);

    if (command.operatorId && !operator) throw new ServiceError('Operator not found', 404);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null invariant established earlier in this function
    if (command.operatorId && operator!.role !== 'OPERATOR') throw new ServiceError('User must have OPERATOR role', 400);
    
    // Check if new operator is already assigned to another crew
    if (command.operatorId && command.operatorId !== aggregate.getState().operatorId) {
      const existingOperatorCrew = await db.crew.findUnique({ 
        where: { operatorId: command.operatorId } 
      });
      if (existingOperatorCrew && existingOperatorCrew.id !== command.crewId) {
        throw new ServiceError('Operator already has a crew', 409);
      }
    }

    if (command.equipmentId && !equipment) throw new ServiceError('Equipment not found', 404);
    if (command.siteId && !site) throw new ServiceError('Site not found', 404);

    // Tenant integrity of the resulting crew: the effective trio (current
    // values overridden by any provided changes) must share one tenant.
    const current = await db.crew.findUnique({
      where: { id: command.crewId },
      select: {
        operator: { select: { tenantId: true } },
        equipment: { select: { tenantId: true } },
        site: { select: { tenantId: true } },
      },
    });
    assertSameTenant({
      operatorTenantId: operator ? operator.tenantId : current?.operator.tenantId ?? null,
      equipmentTenantId: equipment ? equipment.tenantId : current?.equipment.tenantId ?? null,
      siteTenantId: site ? site.tenantId : current?.site.tenantId ?? null,
    });

    // One-rig-one-crew, only when the rig actually changes.
    if (command.equipmentId && command.equipmentId !== aggregate.getState().equipmentId) {
      await assertEquipmentNotDoubleBooked(command.equipmentId, command.crewId);
    }
  }

  // Update crew fields
  if (command.operatorId) {
    aggregate.assignOperator(command.operatorId, command.userId);
  }
  
  if (command.equipmentId) {
    aggregate.assignEquipment(command.equipmentId, command.userId);
  }
  
  if (command.siteId) {
    aggregate.assignToSite(command.siteId, command.userId);
  }

  if (command.name !== undefined) {
    aggregate.update({ name: command.name }, command.userId);
  }

  if (command.isActive !== undefined && command.isActive !== aggregate.getState().isActive) {
    if (command.isActive) {
      aggregate.reactivate(command.userId);
    } else {
      aggregate.deactivate(command.userId);
    }
  }

  // Crew fields + assistant roster persist atomically (one transaction).
  const rosterProvided = command.assistantUserIds !== undefined || command.assistantNames !== undefined;
  let newAssistantRows: Array<{ userId: string | null; name: string }> | undefined;
  if (rosterProvided) {
    const siteTenantId = command.siteId
      ? (await db.site.findUnique({ where: { id: command.siteId }, select: { tenantId: true } }))?.tenantId ?? null
      : (await db.crew.findUnique({
          where: { id: command.crewId },
          select: { site: { select: { tenantId: true } } },
        }))?.site.tenantId ?? null;
    newAssistantRows = await buildAssistantRows(command, siteTenantId);
  }

  await repo.save(aggregate, {
    onBeforeCommit: async (tx) => {
      if (newAssistantRows !== undefined) {
        await tx.crewAssistant.deleteMany({ where: { crewId: command.crewId } });
        if (newAssistantRows.length > 0) {
          await tx.crewAssistant.createMany({
            data: newAssistantRows.map((row) => ({ crewId: command.crewId, ...row })),
          });
        }
      }
    },
  });

  const updated = await db.crew.findUnique({
    where: { id: command.crewId },
    include: { operator: true, equipment: true, site: true, assistants: true },
  });

  await recordAuditEvent({
    action: 'crew.updated',
    scope: 'crews',
    actorId: command.userId || null,
    targetId: command.crewId,
    metadata: {
      before,
      after: crewAuditSnapshot(
        aggregate.getState(),
        newAssistantRows ? newAssistantRows.map((r) => r.name) : beforeAssistants,
      ),
    },
  });

  return updated;
}

export async function deleteCrew(command: DeleteCrewCommand) {
  const repo = getCrewRepository();
  const aggregate = await repo.findById(command.crewId);
  if (!aggregate) {
    throw new ServiceError('Crew not found', 404);
  }

  if (!aggregate.getState().isActive) {
    throw new ServiceError('Crew is already deactivated', 400);
  }

  const assistantNames = (
    await db.crewAssistant.findMany({ where: { crewId: command.crewId }, select: { name: true } })
  ).map((a) => a.name);
  const snapshot = crewAuditSnapshot(aggregate.getState(), assistantNames);

  // Soft delete via domain — deactivate, never hard-delete. Reports stay
  // intact (they are the product's evidence trail). Reactivation is possible.
  aggregate.deactivate(command.userId);
  await repo.save(aggregate);

  await recordAuditEvent({
    action: 'crew.deleted',
    scope: 'crews',
    actorId: command.userId || null,
    targetId: command.crewId,
    metadata: { ...snapshot, deactivated: true },
  });

  return { success: true, deactivated: true };
}

export async function assignCrewToSite(crewId: string, siteId: string, userId?: string) {
  const repo = getCrewRepository();
  const aggregate = await repo.findById(crewId);
  if (!aggregate) throw new ServiceError('Crew not found', 404);

  const fromSiteId = aggregate.getState().siteId;
  aggregate.assignToSite(siteId, userId);
  await repo.save(aggregate);

  await recordAuditEvent({
    action: 'crew.updated',
    scope: 'crews',
    actorId: userId || null,
    targetId: crewId,
    metadata: { before: { siteId: fromSiteId }, after: { siteId } },
  });
}
