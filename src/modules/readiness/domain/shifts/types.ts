export type ShiftType = 'DAY' | 'NIGHT';
export type ShiftState = 'PLANNED' | 'STARTED' | 'HANDOVER_PENDING' | 'CLOSED' | 'CANCELLED';
export type ShiftHandoverState = 'DRAFT' | 'SUBMITTED' | 'REWORK_REQUIRED' | 'ACCEPTED';

export interface ShiftRecord {
  id: string;
  tenantId: string;
  equipmentId: string;
  type: ShiftType;
  state: ShiftState;
  productionDate: Date;
  timezone: string;
  plannedStartAt: Date | null;
  plannedEndAt: Date | null;
  version: number;
}

export interface ShiftHandoverRecord {
  id: string;
  tenantId: string;
  shiftId: string;
  state: ShiftHandoverState;
  version: number;
}
