/**
 * Equipment Module — DDD Bounded Context
 */
export { EquipmentAggregate } from './domain/equipment.aggregate';
export type { EquipmentInfo, EquipmentCreateData } from './domain/equipment.aggregate';
export { createEquipment, updateEquipment, retireEquipment, deleteEquipment } from './application/commands/equipment-command.service';
export { updateEquipmentMetadata } from './application/commands/equipment-metadata';
export { createEquipmentDocument, updateEquipmentDocument, deleteEquipmentDocument } from './application/commands/equipment-document';
export type { EquipmentDocumentInput, EquipmentDocumentType } from './application/commands/equipment-document';
export { createMaintenance, updateMaintenance, deleteMaintenance, acceptMaintenance } from './application/commands/equipment-maintenance';
export type { MaintenanceInput, MaintenanceType, MaintenanceStatus, MaintenancePriority } from './application/commands/equipment-maintenance';
export { addMeterReading, deleteMeterReading } from './application/commands/meter-reading';
export type { MeterReadingInput, MeterSource, AddMeterReadingResult } from './application/commands/meter-reading';
export { createMaintenancePlan, updateMaintenancePlan, deleteMaintenancePlan } from './application/commands/maintenance-plan';
export type { MaintenancePlanInput } from './application/commands/maintenance-plan';
export { runPmScheduler, evaluatePlanDue } from './application/commands/pm-scheduler';
export type { PmTriggerType, PmDueStatus, PlanForEval, PlanDueResult, PmSchedulerResult } from './application/commands/pm-scheduler';
export type { CreateEquipmentCommand, UpdateEquipmentCommand } from './application/commands/equipment.command';
export { getAccessibleEquipment, getEquipmentById, getEquipmentByIdOrThrow, getEquipmentDetails, getMaintenanceById, listAllEquipment, listAllMaintenance, listEquipmentWithCrewCounts, listEquipmentCatalog, listMaintenance, listMeterReadings, listMaintenancePlans } from './application/queries/equipment-query.service';
export type { MaintenanceListFilter } from './application/queries/equipment-query.service';
export { getEquipmentRepository } from './infrastructure/equipment.repository';
