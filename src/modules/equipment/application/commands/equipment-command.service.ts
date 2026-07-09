/**
 * Equipment Command Service
 */
import { db } from '@/lib/db';
import { ServiceError } from '@/lib/service-error';
import { EquipmentAggregate } from '../../domain';
import { getEquipmentRepository } from '../../infrastructure';
import { CreateEquipmentCommand, UpdateEquipmentCommand } from './equipment.command';

export async function createEquipment(cmd: CreateEquipmentCommand) {
  const agg = EquipmentAggregate.create(
    { name: cmd.name, model: cmd.model, qty: cmd.qty, description: cmd.description, tenantId: cmd.tenantId },
    cmd.userId,
  );
  await getEquipmentRepository().save(agg);
  return db.equipment.findUnique({ where: { id: agg.getState().id } });
}

export async function updateEquipment(cmd: UpdateEquipmentCommand) {
  const repo = getEquipmentRepository();
  const agg = await repo.findById(cmd.equipmentId, cmd.tenantId);
  if (!agg) throw new ServiceError('Equipment not found', 404);
  agg.update({ name: cmd.name, model: cmd.model, qty: cmd.qty, description: cmd.description, isActive: cmd.isActive }, cmd.userId);
  await repo.save(agg);
}

export async function retireEquipment(equipmentId: string, tenantId: string, userId?: string) {
  const repo = getEquipmentRepository();
  const agg = await repo.findById(equipmentId, tenantId);
  if (!agg) throw new ServiceError('Equipment not found', 404);
  agg.retire(userId);
  await repo.save(agg);
}

export async function deleteEquipment(equipmentId: string, tenantId: string) {
  const existing = await db.equipment.findUnique({
    where: { id: equipmentId, tenantId },
    include: { crews: { where: { isActive: true } } },
  });
  if (!existing) throw new ServiceError('Equipment not found', 404);
  if (existing.crews.length > 0) {
    throw new ServiceError('Cannot delete equipment with linked active crews', 409);
  }
  await db.equipment.delete({ where: { id: equipmentId } });
  return { success: true };
}
