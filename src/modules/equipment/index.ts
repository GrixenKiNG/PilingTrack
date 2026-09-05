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
export { addMeterReading, deleteMeterReading, recordMeterReadingInTx, checkMeterReading, canDecreaseMeter, METER_JUMP_WARN_HOURS } from './application/commands/meter-reading';
export type { MeterReadingInput, MeterSource, AddMeterReadingResult, MeterReadingContext } from './application/commands/meter-reading';
export { addFuelEntry, deleteFuelEntry, computeFuelConsumption } from './application/commands/fuel-log';
export { resolveEquipmentOperationalStates } from './application/queries/operational-state';
export type { EquipmentOperationalState } from './application/queries/operational-state';
export type { FuelLogInput, FuelLogContext, FuelConsumption, FuelConsumptionInput } from './application/commands/fuel-log';
export { createMaintenancePlan, updateMaintenancePlan, deleteMaintenancePlan } from './application/commands/maintenance-plan';
export type { MaintenancePlanInput } from './application/commands/maintenance-plan';
export { runPmScheduler, evaluatePlanDue } from './application/commands/pm-scheduler';
export type { PmTriggerType, PmDueStatus, PlanForEval, PlanDueResult, PmSchedulerResult } from './application/commands/pm-scheduler';
export type { CreateEquipmentCommand, UpdateEquipmentCommand } from './application/commands/equipment.command';
export { getAccessibleEquipment, getEquipmentById, getEquipmentByIdOrThrow, getEquipmentDetails, getMaintenanceById, listAllEquipment, listAllMaintenance, listEquipmentWithCrewCounts, listEquipmentCatalog, listMaintenance, listMeterReadings, listFuelLog, getFuelSummary, listMaintenancePlans, getFleetKpiData } from './application/queries/equipment-query.service';
export type { MaintenanceListFilter } from './application/queries/equipment-query.service';
export { getEquipmentRepository } from './infrastructure/equipment.repository';
