/**
 * Equipment Module — DDD Bounded Context
 */
export { EquipmentAggregate } from './domain/equipment.aggregate';
export type { EquipmentInfo, EquipmentCreateData } from './domain/equipment.aggregate';
export { createEquipment, updateEquipment, retireEquipment } from './application/commands/equipment-command.service';
export type { CreateEquipmentCommand, UpdateEquipmentCommand } from './application/commands/equipment.command';
export { getAccessibleEquipment, getEquipmentById, listAllEquipment } from './application/queries/equipment-query.service';
export { getEquipmentRepository } from './infrastructure/equipment.repository';
