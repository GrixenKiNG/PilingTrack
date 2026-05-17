/**
 * Equipment Module — DDD Bounded Context
 */
export { EquipmentAggregate } from './domain/equipment.aggregate';
export type { EquipmentInfo, EquipmentCreateData } from './domain/equipment.aggregate';
export { createEquipment, updateEquipment, retireEquipment, deleteEquipment } from './application/commands/equipment-command.service';
export { updateEquipmentMetadata } from './application/commands/equipment-metadata';
export type { CreateEquipmentCommand, UpdateEquipmentCommand } from './application/commands/equipment.command';
export { getAccessibleEquipment, getEquipmentById, getEquipmentByIdOrThrow, getEquipmentDetails, listAllEquipment, listEquipmentWithCrewCounts, listEquipmentCatalog } from './application/queries/equipment-query.service';
export { getEquipmentRepository } from './infrastructure/equipment.repository';
