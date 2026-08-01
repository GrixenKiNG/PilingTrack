import {ReadinessCommandError} from '../../application/command-pipeline/errors';
import type {WorkPermitState} from './types';

const ALLOWED: Record<string, readonly WorkPermitState[]> = {
  submit: ['DRAFT'],
  approve: ['PENDING_APPROVAL'],
  edit: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'],
  revoke: ['APPROVED'],
  expire: ['APPROVED'],
};

export function assertPermitTransition(state: WorkPermitState, command: keyof typeof ALLOWED): void {
  if (!ALLOWED[command].includes(state)) {
    throw new ReadinessCommandError(
      'VALIDATION_ERROR', 422,
      `Work permit in state ${state} cannot execute ${command}`,
      {state, command},
    );
  }
}

export function transitionPermit(state: WorkPermitState, command: string): WorkPermitState {
  if (command === 'submit') { assertPermitTransition(state, 'submit'); return 'PENDING_APPROVAL'; }
  if (command === 'approve') { assertPermitTransition(state, 'approve'); return state; }
  if (command === 'edit') { assertPermitTransition(state, 'edit'); return 'DRAFT'; }
  if (command === 'revoke') { assertPermitTransition(state, 'revoke'); return 'REVOKED'; }
  if (command === 'expire') { assertPermitTransition(state, 'expire'); return 'EXPIRED'; }
  throw new ReadinessCommandError('VALIDATION_ERROR', 422, `Unknown permit command ${command}`);
}
