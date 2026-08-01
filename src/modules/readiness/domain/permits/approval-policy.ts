import {ReadinessCommandError} from '../../application/command-pipeline/errors';
import type {
  WorkPermitApprovalRecord,
  WorkPermitApprovalRole,
  WorkPermitRecord,
  WorkPermitRisk,
} from './types';

export function requiredApprovalRoles(risk: WorkPermitRisk): readonly WorkPermitApprovalRole[] {
  return risk === 'NORMAL' ? ['DISPATCHER'] : ['DISPATCHER', 'ADMIN'];
}

export function assertCanApprovePermit(input: {
  permit: WorkPermitRecord;
  actorId: string;
  role: string;
  approvals: WorkPermitApprovalRecord[];
}): WorkPermitApprovalRole {
  const role = input.role === 'DISPATCHER' || input.role === 'ADMIN' ? input.role : null;
  if (!role || !requiredApprovalRoles(input.permit.risk).includes(role)) {
    throw new ReadinessCommandError('VALIDATION_ERROR', 403, 'Actor cannot approve this permit');
  }
  if (input.actorId === input.permit.authorId || input.actorId === input.permit.lastEditedById) {
    throw new ReadinessCommandError('VALIDATION_ERROR', 422, 'Permit author or last editor cannot self-approve');
  }
  const current = input.approvals.filter((item) =>
    item.valid && item.permitVersion === input.permit.version);
  if (current.some((item) => item.role === role)) {
    throw new ReadinessCommandError('VERSION_CONFLICT', 409, `${role} approval already exists`);
  }
  if (current.some((item) => item.approvedById === input.actorId)) {
    throw new ReadinessCommandError(
      'VALIDATION_ERROR', 422, 'Elevated approvals require distinct users',
    );
  }
  return role;
}

export function isApprovalComplete(
  risk: WorkPermitRisk,
  approvals: WorkPermitApprovalRecord[],
  version: number,
): boolean {
  const current = approvals.filter((item) => item.valid && item.permitVersion === version);
  const roles = new Set(current.map((item) => item.role));
  const users = new Set(current.map((item) => item.approvedById));
  const required = requiredApprovalRoles(risk);
  return required.every((role) => roles.has(role))
    && (risk === 'NORMAL' || users.size === required.length);
}
