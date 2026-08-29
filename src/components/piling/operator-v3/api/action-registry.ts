import type {OperatorAction} from './contracts';
import {OperatorV3ApiError} from './api-error';

export type OperatorFormId = 'DEFECT' | 'SAFETY_INCIDENT' | 'PHOTO';

export const PRODUCTION_ACTION_IDS = ['record-production', 'start-break', 'start-downtime', 'finish-interval'] as const;
export type ProductionActionId = typeof PRODUCTION_ACTION_IDS[number];

export function isProductionAction(action: OperatorAction | null | undefined): action is OperatorAction & {id: ProductionActionId} {
  return Boolean(action && (PRODUCTION_ACTION_IDS as readonly string[]).includes(action.id));
}

const formByActionId: Readonly<Record<string, OperatorFormId>> = {
  'report-defect': 'DEFECT',
  'report-incident': 'SAFETY_INCIDENT',
  'add-photo': 'PHOTO',
};

export function operatorFormForAction(action: OperatorAction): OperatorFormId | null {
  return formByActionId[action.id] ?? null;
}

export function createOperatorCommandId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `cmd-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function assertServerAction(action: OperatorAction): OperatorAction {
  if (action.kind === 'COMMAND' && (!action.route || action.method !== 'POST')) {
    throw new OperatorV3ApiError('Сервер не предоставил безопасный способ выполнить действие', 'НЕКОРРЕКТНОЕ_ДЕЙСТВИЕ');
  }
  return action;
}

export interface OperatorCommandEnvelope {
  commandId: string;
  deviceId: string;
  deviceSequence: number;
  occurredAt: string;
  payload: Record<string, unknown>;
  aggregateId?: string;
}

export function buildOperatorCommandRequest(action: OperatorAction, envelope: OperatorCommandEnvelope) {
  const safeAction = assertServerAction(action);
  if (safeAction.kind !== 'COMMAND' || !safeAction.route || safeAction.method !== 'POST') {
    throw new OperatorV3ApiError('Это действие нельзя отправить как команду', 'ДЕЙСТВИЕ_НЕ_КОМАНДА');
  }
  return {
    route: safeAction.route,
    method: safeAction.method,
    headers: {
      'Content-Type': 'application/json',
      accept: 'application/json',
      'Idempotency-Key': envelope.commandId,
      ...(safeAction.expectedVersion === undefined ? {} : {'If-Match': `v${safeAction.expectedVersion}`}),
    },
    body: JSON.stringify({...envelope, expectedVersion: safeAction.expectedVersion}),
  } as const;
}
