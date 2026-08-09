import {ReadinessCommandError} from '../../application/command-pipeline/errors';
import type {ShiftHandoverState, ShiftState} from './types';

const SHIFT_ALLOWED = {
  edit: ['PLANNED'],
  // Оператор просит допуск, запускает смену диспетчер. Прямой запуск из
  // PLANNED убран намеренно: иначе допуск можно обойти.
  request: ['PLANNED'],
  start: ['PENDING_ACCEPTANCE'],
  decline: ['PENDING_ACCEPTANCE'],
  cancel: ['PLANNED', 'PENDING_ACCEPTANCE', 'STARTED'],
  handover: ['STARTED'],
  accept: ['HANDOVER_PENDING'],
  rework: ['HANDOVER_PENDING'],
} satisfies Record<string, readonly ShiftState[]>;

const HANDOVER_ALLOWED = {
  submit: ['DRAFT', 'REWORK_REQUIRED'],
  accept: ['SUBMITTED'],
  rework: ['SUBMITTED'],
} satisfies Record<string, readonly ShiftHandoverState[]>;

export function assertShiftTransition(state: ShiftState, command: keyof typeof SHIFT_ALLOWED): void {
  if (!(SHIFT_ALLOWED[command] as readonly ShiftState[]).includes(state)) {
    throw new ReadinessCommandError('VERSION_CONFLICT', 409, `Shift in state ${state} cannot execute ${command}`, {state, command});
  }
}

export function transitionShift(state: ShiftState, command: keyof typeof SHIFT_ALLOWED): ShiftState {
  assertShiftTransition(state, command);
  if (command === 'request') return 'PENDING_ACCEPTANCE';
  if (command === 'start' || command === 'rework') return 'STARTED';
  if (command === 'cancel') return 'CANCELLED';
  if (command === 'handover') return 'HANDOVER_PENDING';
  if (command === 'accept') return 'CLOSED';
  // decline возвращает смену оператору на доработку до запуска
  return 'PLANNED';
}

export function assertHandoverTransition(state: ShiftHandoverState, command: keyof typeof HANDOVER_ALLOWED): void {
  if (!(HANDOVER_ALLOWED[command] as readonly ShiftHandoverState[]).includes(state)) {
    throw new ReadinessCommandError('VERSION_CONFLICT', 409, `Handover in state ${state} cannot execute ${command}`, {state, command});
  }
}

export function transitionHandover(state: ShiftHandoverState, command: keyof typeof HANDOVER_ALLOWED): ShiftHandoverState {
  assertHandoverTransition(state, command);
  if (command === 'submit') return 'SUBMITTED';
  if (command === 'accept') return 'ACCEPTED';
  return 'REWORK_REQUIRED';
}
