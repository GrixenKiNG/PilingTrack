import type {OperatorChecklistItemDefinition} from './operator-checklist-types';

export const CRITICAL_OPERATOR_RULES = {
  stability: 'EQUIPMENT_STABILITY_REQUIRED',
  mastIntegrity: 'MAST_LOAD_BEARING_INTEGRITY_REQUIRED',
  hydraulicIntegrity: 'HIGH_PRESSURE_HOSE_INTEGRITY_REQUIRED',
  ropeIntegrity: 'ROPE_INTEGRITY_REQUIRED',
  emergencyStop: 'EMERGENCY_STOP_REQUIRED',
  safePileStrike: 'PILE_STRIKE_ZONE_MUST_BE_CLEAR',
  rotationStopped: 'ROTATION_MUST_BE_STOPPED',
} as const;

export function isCriticalOperatorChecklistItem(item: OperatorChecklistItemDefinition): boolean {
  return item.criticality === 'CRITICAL' || item.ruleCode !== null;
}
