/**
 * Equipment Command Service
 */
import { db } from '@/lib/db';
import { EquipmentAggregate } from '../../domain';
import { getEquipmentRepository } from '../../infrastructure';
import { CreateEquipmentCommand, UpdateEquipmentCommand } from './equipment.command';

export async function createEquipment(cmd: CreateEquipmentCommand) {
  const agg = EquipmentAggregate.create({ name: cmd.name, model: cmd.model, qty: cmd.qty, description: cmd.description }, cmd.userId);
  await getEquipmentRepository().save(agg);
  return db.equipment.findUnique({ where: { id: agg.getState().id } });
}

export async function updateEquipment(cmd: UpdateEquipmentCommand) {
  const repo = getEquipmentRepository();
  const agg = await repo.findById(cmd.equipmentId);
  if (!agg) throw new Error('Equipment not found');
  agg.update({ name: cmd.name, model: cmd.model, qty: cmd.qty, description: cmd.description }, cmd.userId);
  await repo.save(agg);
}

export async function retireEquipment(equipmentId: string, userId?: string) {
  const repo = getEquipmentRepository();
  const agg = await repo.findById(equipmentId);
  if (!agg) throw new Error('Equipment not found');
  agg.retire(userId);
  await repo.save(agg);
}
