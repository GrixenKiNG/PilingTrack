/**
 * Crew Command Service
 */

import { db, DEFAULT_TX_OPTIONS } from '@/lib/db';
import { ServiceError } from '@/services/service-error';
import { CrewAggregate } from '../../domain';
import { getCrewRepository } from '../../infrastructure';
import { CreateCrewCommand, UpdateCrewCommand, DeleteCrewCommand } from './crew.command';
import { logger } from '@/lib/logger';

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

  const aggregate = CrewAggregate.create({
    name,
    operatorId: command.operatorId,
    equipmentId: command.equipmentId,
    siteId: command.siteId,
  }, command.userId);

  try {
    await getCrewRepository().save(aggregate);

    // Create crew assistants after crew is created
    if (command.assistantNames && command.assistantNames.length > 0) {
      const assistantData = command.assistantNames
        .filter((name) => name.trim().length > 0)
        .map((name) => ({
          crewId: aggregate.getState().id,
          name: name.trim(),
        }));
      
      if (assistantData.length > 0) {
        await db.crewAssistant.createMany({ data: assistantData });
      }
    }
  } catch (error) {
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

  return db.crew.findUnique({
    where: { id: aggregate.getState().id },
    include: { operator: true, equipment: true, site: true, assistants: true },
  });
}

export async function updateCrew(command: UpdateCrewCommand) {
  const repo = getCrewRepository();
  const aggregate = await repo.findById(command.crewId);
  if (!aggregate) {
    throw new ServiceError('Crew not found', 404);
  }

  // Validate dependencies if operator/equipment/site are being changed
  if (command.operatorId || command.equipmentId || command.siteId) {
    const [operator, equipment, site] = await Promise.all([
      command.operatorId ? db.user.findUnique({ where: { id: command.operatorId } }) : null,
      command.equipmentId ? db.equipment.findUnique({ where: { id: command.equipmentId } }) : null,
      command.siteId ? db.site.findUnique({ where: { id: command.siteId } }) : null,
    ]);

    if (command.operatorId && !operator) throw new ServiceError('Operator not found', 404);
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

  if (command.isActive !== undefined) {
    if (command.isActive) {
      aggregate.reactivate(command.userId);
    } else {
      aggregate.deactivate(command.userId);
    }
  }

  await repo.save(aggregate);

  // Update crew assistants if provided
  if (command.assistantNames !== undefined) {
    // Delete existing assistants
    await db.crewAssistant.deleteMany({ where: { crewId: command.crewId } });
    
    // Create new assistants
    if (command.assistantNames.length > 0) {
      const assistantData = command.assistantNames
        .filter((name) => name.trim().length > 0)
        .map((name) => ({
          crewId: command.crewId,
          name: name.trim(),
        }));
      
      if (assistantData.length > 0) {
        await db.crewAssistant.createMany({ data: assistantData });
      }
    }
  }

  return db.crew.findUnique({
    where: { id: command.crewId },
    include: { operator: true, equipment: true, site: true, assistants: true },
  });
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

  if (command.force) {
    // Force delete: delete linked reports first (bypasses domain for reports)
    await db.$transaction(async (tx: any) => {
      await tx.report.deleteMany({ where: { crewId: command.crewId } });
      await tx.crew.delete({ where: { id: command.crewId } });
    }, DEFAULT_TX_OPTIONS);
    return { success: true, deletedReports: true };
  }

  // Soft delete via domain — deactivate instead of hard delete
  aggregate.deactivate(command.userId);
  await repo.save(aggregate);

  return { success: true, deactivated: true };
}

export async function assignCrewToSite(crewId: string, siteId: string, userId?: string) {
  const repo = getCrewRepository();
  const aggregate = await repo.findById(crewId);
  if (!aggregate) throw new ServiceError('Crew not found', 404);

  aggregate.assignToSite(siteId, userId);
  await repo.save(aggregate);
}
