export type ShiftType = 'DAY' | 'NIGHT';
/**
 * PENDING_ACCEPTANCE — предсменный допуск: оператор подготовил установку и ждёт
 * решения диспетчера. До появления этого состояния смену запускал сам оператор,
 * а «приёмка» стояла в конце и закрывала смену, то есть человеческого допуска
 * перед работой не существовало вовсе.
 */
export type ShiftState =
  | 'PLANNED'
  | 'PENDING_ACCEPTANCE'
  | 'STARTED'
  | 'HANDOVER_PENDING'
  | 'CLOSED'
  | 'CANCELLED';
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
